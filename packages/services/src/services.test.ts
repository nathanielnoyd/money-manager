import { parseCsv } from "@mm/core";
import { schema, seedDemoData, withHousehold } from "@mm/db";
import { createTestDatabase, type TestDatabase, testDatabaseUrl } from "@mm/db/testing";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTransaction,
  authenticateToken,
  budgetStatus,
  createApiToken,
  deleteTransaction,
  execute,
  exportHousehold,
  exportTransactionsCsv,
  listApiTokens,
  listRules,
  OPERATIONS,
  OperationError,
  type Principal,
  revokeApiToken,
  SCOPES,
  saveRule,
  searchTransactions,
  sessionPrincipal,
  setBudget,
  updateTransaction,
  updateTransactions,
} from "./index";

const adminUrl = testDatabaseUrl();

describe("operation registry", () => {
  it("has unique snake_case names, descriptions and object inputs", () => {
    const names = OPERATIONS.map((o) => o.name);
    expect(new Set(names).size).toBe(names.length);
    for (const op of OPERATIONS) {
      expect(op.name).toMatch(/^[a-z][a-z_]+$/);
      expect(op.description.length).toBeGreaterThan(20);
      expect(op.readOnly).toBe(op.scope === "read");
      if (!op.readOnly) expect(op.minRole).not.toBe("viewer");
    }
  });
});

describe.skipIf(!adminUrl)("operations and agent tokens (integration)", () => {
  let t: TestDatabase;
  let hA: string;
  let hB: string;
  let owner: Principal;
  let ownerB: Principal;
  let categoryB: string;
  let txnB: string;
  let groceries: string;

  const ownerOf = async (householdId: string) => {
    const [m] = await t.admin
      .select()
      .from(schema.householdMembers)
      .where(eq(schema.householdMembers.householdId, householdId));
    return sessionPrincipal({ userId: m?.userId as string, householdId, role: "owner" });
  };
  const errorOf = (p: Promise<unknown>) => p.then(() => null).catch((e: unknown) => e);

  beforeAll(async () => {
    t = await createTestDatabase(adminUrl as string);
    hA = await t.household("A");
    hB = await t.household("B");
    await seedDemoData(t.app, hA, { months: 2, today: new Date("2026-06-30") });
    await seedDemoData(t.app, hB, { months: 1, today: new Date("2026-06-30") });
    owner = await ownerOf(hA);
    ownerB = await ownerOf(hB);
    [categoryB, txnB] = await withHousehold(t.app, hB, async (tx) => {
      const [c] = await tx.select().from(schema.categories).limit(1);
      const [x] = await tx.select().from(schema.transactions).limit(1);
      return [c?.id as string, x?.id as string];
    });
    groceries = await withHousehold(t.app, hA, async (tx) => {
      const [c] = await tx
        .select()
        .from(schema.categories)
        .where(eq(schema.categories.name, "Groceries"));
      return c?.id as string;
    });
  });
  afterAll(() => t?.cleanup());

  it("checks role, scope and input before touching data", async () => {
    const viewer: Principal = { ...owner, role: "viewer" };
    const input = { categoryId: groceries, month: "2026-06-01", amount: 10 };
    expect(await errorOf(execute(t.app, viewer, setBudget, input))).toMatchObject({
      code: "forbidden",
    });
    const readOnly: Principal = { ...owner, via: "token", scopes: ["read"] };
    const e = await errorOf(execute(t.app, readOnly, setBudget, input));
    expect(e).toBeInstanceOf(OperationError);
    expect((e as Error).message).toMatch(/planning:write/);
    expect(
      await errorOf(execute(t.app, owner, setBudget, { ...input, month: "2026-06-15" })),
    ).toMatchObject({ code: "invalid_input" });
    expect(
      await errorOf(execute(t.app, owner, setBudget, { ...input, amount: 1.234 })),
    ).toMatchObject({ code: "invalid_input" });
  });

  it("takes and returns dollars, stores cents", async () => {
    await execute(t.app, owner, setBudget, {
      categoryId: groceries,
      month: "2026-06-01",
      amount: 612.34,
    });
    const [row] = await withHousehold(t.app, hA, (tx) =>
      tx.select().from(schema.budgetItems).where(eq(schema.budgetItems.categoryId, groceries)),
    );
    expect(row?.amount).toBe(61234);
    const status = await execute(t.app, owner, budgetStatus, { month: "2026-06-01" });
    expect(status.find((l) => l.categoryId === groceries)?.budgeted).toBe(612.34);

    const r = await execute(t.app, owner, saveRule, {
      name: "Big groceries",
      conditions: [
        { field: "merchant", op: "contains", value: "Market" },
        { field: "amount", op: "between", value: 50, value2: 99.5 },
      ],
      actions: { setCategoryId: groceries },
    });
    const [stored] = await withHousehold(t.app, hA, (tx) =>
      tx.select().from(schema.rules).where(eq(schema.rules.id, r.id)),
    );
    expect(stored?.conditions).toContainEqual({
      field: "amount",
      op: "between",
      value: 5000,
      value2: 9950,
    });
    const rules = await execute(t.app, owner, listRules, {});
    expect(rules.find((x) => x.id === r.id)?.conditions).toContainEqual({
      field: "amount",
      op: "between",
      value: 50,
      value2: 99.5,
    });
  });

  it("can't reach another household's rows or reference them", async () => {
    expect(
      await errorOf(execute(t.app, owner, updateTransaction, { id: txnB, notes: "x" })),
    ).toMatchObject({ code: "not_found" });
    expect(
      await execute(t.app, owner, updateTransactions, { ids: [txnB], reviewed: true }),
    ).toEqual({ count: 0 });
    expect(
      await errorOf(
        execute(t.app, owner, setBudget, { categoryId: categoryB, month: "2026-06-01", amount: 5 }),
      ),
    ).toMatchObject({ code: "not_found" });
    const [b] = await withHousehold(t.app, hB, (tx) =>
      tx.select().from(schema.transactions).where(eq(schema.transactions.id, txnB)),
    );
    expect(b?.notes).toBeNull();
  });

  it("matches a category by name, not as a pattern", async () => {
    const range = { start: "2026-01-01", end: "2026-06-30", limit: 5 };
    const byName = await execute(t.app, owner, searchTransactions, {
      ...range,
      category: "groceries",
    });
    expect(byName.length).toBeGreaterThan(0);
    expect(byName.every((r) => r.category === "Groceries")).toBe(true);
    for (const category of ["%", "Grocer%", "_roceries"])
      expect(await execute(t.app, owner, searchTransactions, { ...range, category })).toEqual([]);
  });

  it("finds uncategorized transactions with ids", async () => {
    const [x] = await execute(t.app, owner, searchTransactions, {
      start: "2026-01-01",
      end: "2026-06-30",
      limit: 1,
    });
    await execute(t.app, owner, updateTransaction, { id: x?.id as string, categoryId: null });
    const found = await execute(t.app, owner, searchTransactions, {
      start: "2026-01-01",
      end: "2026-06-30",
      uncategorized: true,
      limit: 100,
    });
    expect(found.map((f) => f.id)).toContain(x?.id);
    expect(found.every((f) => f.category === "Uncategorized")).toBe(true);
  });

  describe("adding and deleting transactions by hand", () => {
    let cash: string;
    let synced: string;

    beforeAll(async () => {
      [cash, synced] = await withHousehold(t.app, hA, async (tx) => {
        const [a] = await tx
          .insert(schema.accounts)
          .values({ householdId: hA, name: "Cash", type: "depository", currentBalance: 10_000 })
          .returning();
        const [c] = await tx
          .insert(schema.connections)
          .values({ householdId: hA, provider: "simplefin", institutionName: "Bank" })
          .returning();
        const [b] = await tx
          .insert(schema.accounts)
          .values({
            householdId: hA,
            name: "Synced",
            type: "depository",
            connectionId: c?.id as string,
          })
          .returning();
        return [a?.id as string, b?.id as string];
      });
    });
    const balanceOf = async (id: string) =>
      (
        await withHousehold(t.app, hA, (tx) =>
          tx.select().from(schema.accounts).where(eq(schema.accounts.id, id)),
        )
      )[0]?.currentBalance;
    const base = { date: "2026-06-20", amount: -12.5, description: "FARMERS MARKET" };

    it("adds a categorized transaction, moves the balance, and deletes it again", async () => {
      const { id } = await execute(t.app, owner, addTransaction, {
        ...base,
        accountId: cash,
        categoryId: groceries,
        notes: " tomatoes ",
      });
      const [row] = await withHousehold(t.app, hA, (tx) =>
        tx.select().from(schema.transactions).where(eq(schema.transactions.id, id)),
      );
      expect(row).toMatchObject({
        amount: -1250,
        date: "2026-06-20",
        categoryId: groceries,
        categorySource: "user",
        notes: "tomatoes",
        reviewed: true,
        pending: false,
      });
      expect(row?.providerTransactionId).toMatch(/^manual:/);
      expect(row?.merchantId).toBeTruthy();
      expect(await balanceOf(cash)).toBe(8_750);

      expect(await execute(t.app, owner, deleteTransaction, { id })).toEqual({ deleted: true });
      expect(await balanceOf(cash)).toBe(10_000);
      expect(await errorOf(execute(t.app, owner, deleteTransaction, { id }))).toMatchObject({
        code: "not_found",
      });
    });

    it("leaves the balance alone when asked", async () => {
      const { id } = await execute(t.app, owner, addTransaction, {
        ...base,
        accountId: cash,
        amount: 40,
        adjustBalance: false,
      });
      expect(await balanceOf(cash)).toBe(10_000);
      await execute(t.app, owner, deleteTransaction, { id, adjustBalance: false });
      expect(await balanceOf(cash)).toBe(10_000);
    });

    it("refuses bank-synced accounts, bank transactions, other households and bad input", async () => {
      expect(
        await errorOf(execute(t.app, owner, addTransaction, { ...base, accountId: synced })),
      ).toMatchObject({ code: "conflict" });
      // A transaction from the seeded (bank-like) data can't be deleted.
      const [seeded] = await execute(t.app, owner, searchTransactions, {
        start: "2026-01-01",
        end: "2026-06-30",
        limit: 1,
      });
      expect(
        await errorOf(execute(t.app, owner, deleteTransaction, { id: seeded?.id as string })),
      ).toMatchObject({ code: "conflict" });
      // Household B can neither add to A's account nor use A's category, nor delete A's rows.
      expect(
        await errorOf(execute(t.app, ownerB, addTransaction, { ...base, accountId: cash })),
      ).toMatchObject({ code: "not_found" });
      const { id } = await execute(t.app, owner, addTransaction, { ...base, accountId: cash });
      expect(await errorOf(execute(t.app, ownerB, deleteTransaction, { id }))).toMatchObject({
        code: "not_found",
      });
      expect(
        await errorOf(
          execute(t.app, owner, addTransaction, {
            ...base,
            accountId: cash,
            categoryId: categoryB,
          }),
        ),
      ).toMatchObject({ code: "not_found" });
      for (const amount of [0, 1.234, Number.NaN])
        expect(
          await errorOf(
            execute(t.app, owner, addTransaction, { ...base, accountId: cash, amount }),
          ),
        ).toMatchObject({ code: "invalid_input" });
    });

    it("needs the member role and the transactions:write scope", async () => {
      const input = { ...base, accountId: cash };
      expect(
        await errorOf(execute(t.app, { ...owner, role: "viewer" }, addTransaction, input)),
      ).toMatchObject({ code: "forbidden" });
      const readOnly: Principal = { ...owner, via: "token", scopes: ["read"] };
      expect(
        (await errorOf(execute(t.app, readOnly, addTransaction, input))) as Error,
      ).toMatchObject({ message: expect.stringMatching(/transactions:write/) });
    });
  });

  describe("export", () => {
    it("exports the household's own data, without credentials", async () => {
      await withHousehold(t.app, hA, (tx) =>
        tx.insert(schema.connections).values({
          householdId: hA,
          provider: "simplefin",
          institutionName: "Export Bank",
          secretSealed: "SEALED-SECRET-VALUE",
          cursor: "CURSOR-VALUE",
        }),
      );
      const [data, countA, countB] = await Promise.all([
        withHousehold(t.app, hA, (tx) => exportHousehold(tx, hA)),
        withHousehold(t.app, hA, (tx) => tx.$count(schema.transactions)),
        withHousehold(t.app, hB, (tx) => tx.$count(schema.transactions)),
      ]);
      expect(data.transactions).toHaveLength(countA);
      expect(countB).toBeGreaterThan(0);
      expect(data.household?.name).toBe("A");
      expect(data.connections.map((c) => c.institutionName)).toContain("Export Bank");
      const text = JSON.stringify(data);
      for (const secret of ["SEALED-SECRET-VALUE", "CURSOR-VALUE", "secretSealed", "tokenHash"])
        expect(text).not.toContain(secret);
      expect(text).not.toContain(txnB);
      expect(text).not.toContain(hB);
      expect(OPERATIONS.map((o) => o.name).filter((n) => n.includes("export"))).toEqual([
        "export_catalog_patch",
      ]);
    });

    it("writes transactions as CSV, with a split as its parts", async () => {
      const csv = await withHousehold(t.app, hA, async (tx) => {
        const [parent] = await tx
          .select()
          .from(schema.transactions)
          .where(and(isNull(schema.transactions.splitParentId), sql`amount = -1250`))
          .limit(1);
        const [any] = parent
          ? [parent]
          : await tx.select().from(schema.transactions).where(sql`amount < -100`).limit(1);
        const p = any as typeof schema.transactions.$inferSelect;
        const part = {
          householdId: hA,
          accountId: p.accountId,
          date: p.date,
          rawDescription: p.rawDescription,
          splitParentId: p.id,
        };
        await tx.insert(schema.transactions).values([
          { ...part, amount: p.amount + 100, notes: "=cmd|' /C calc'!A0" },
          { ...part, amount: -100 },
        ]);
        await tx
          .update(schema.transactions)
          .set({ isSplit: true })
          .where(eq(schema.transactions.id, p.id));
        return { csv: await exportTransactionsCsv(tx), parentId: p.id, total: p.amount };
      });
      const rows = parseCsv(csv.csv, ",");
      const col = (name: string) => (rows[0] as string[]).indexOf(name);
      expect(rows[0]?.slice(0, 3)).toEqual(["Date", "Account", "Description"]);
      const parts = rows.filter((r) => r[col("Split of")] === csv.parentId);
      expect(parts).toHaveLength(2);
      expect(rows.some((r) => r[col("Id")] === csv.parentId)).toBe(false);
      const cents = parts.reduce((n, r) => n + Math.round(Number(r[col("Amount")]) * 100), 0);
      expect(cents).toBe(csv.total);
      // A note that starts like a formula is defused; amounts are untouched.
      expect(parts.map((r) => r[col("Notes")])).toContain("'=cmd|' /C calc'!A0");
      expect(rows.slice(1).every((r) => /^-?\d+\.\d{2}$/.test(r[col("Amount")] as string))).toBe(
        true,
      );
    });
  });

  describe("agent tokens", () => {
    let token: string;
    let tokenId: string;

    it("authenticates as the creator with the token's scopes, and audits writes", async () => {
      const r = await withHousehold(t.app, hA, (tx) =>
        createApiToken(tx, owner, { name: "Claude", scopes: ["transactions:write"] }),
      );
      token = r.token;
      tokenId = r.id;
      expect(token).toMatch(/^mm_pat_[A-Za-z0-9_-]{43}$/);
      const p = await authenticateToken(t.app, token, { ip: "100.64.0.1" });
      expect(p).toMatchObject({
        householdId: hA,
        userId: owner.userId,
        role: "member",
        via: "token",
        tokenId,
      });
      expect(p?.scopes).toEqual(["read", "transactions:write"]);

      const [x] = await execute(t.app, p as Principal, searchTransactions, {
        start: "2026-01-01",
        end: "2026-06-30",
        limit: 1,
      });
      await execute(t.app, p as Principal, updateTransaction, {
        id: x?.id as string,
        reviewed: true,
      });
      const audit = await withHousehold(t.app, hA, (tx) =>
        tx.select().from(schema.auditLog).where(eq(schema.auditLog.action, "agent.write")),
      );
      expect(audit.at(-1)?.detail).toEqual({ operation: "update_transaction", tokenId });
      const [row] = await withHousehold(t.app, hA, (tx) =>
        tx.select().from(schema.apiTokens).where(eq(schema.apiTokens.id, tokenId)),
      );
      expect(row?.lastUsedIp).toBe("100.64.0.1");
      expect(row?.tokenHash).not.toContain(token);
    });

    it("rejects malformed, unknown, expired and revoked tokens", async () => {
      expect(await authenticateToken(t.app, "nope")).toBeNull();
      expect(await authenticateToken(t.app, `mm_pat_${"A".repeat(43)}`)).toBeNull();

      const exp = await withHousehold(t.app, hA, (tx) =>
        createApiToken(tx, owner, { name: "old", scopes: ["read"], expiresInDays: 7 }),
      );
      await t.admin
        .update(schema.apiTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.apiTokens.id, exp.id));
      expect(await authenticateToken(t.app, exp.token)).toBeNull();

      const rev = await withHousehold(t.app, hA, (tx) =>
        createApiToken(tx, owner, { name: "rev", scopes: ["read"] }),
      );
      expect(await authenticateToken(t.app, rev.token)).not.toBeNull();
      expect(await withHousehold(t.app, hA, (tx) => revokeApiToken(tx, owner, rev.id))).toBe(true);
      expect(await authenticateToken(t.app, rev.token)).toBeNull();
    });

    it("follows the creator's current membership", async () => {
      const [u] = await t.admin
        .insert(schema.users)
        .values({ email: `m-${Date.now()}@example.test`, displayName: "M", webauthnUserId: "m1" })
        .returning();
      const userId = u?.id as string;
      await t.admin
        .insert(schema.householdMembers)
        .values({ householdId: hA, userId, role: "member" });
      const member = sessionPrincipal({ userId, householdId: hA, role: "member" });
      const { token: mt, id } = await withHousehold(t.app, hA, (tx) =>
        createApiToken(tx, member, {
          name: "m",
          scopes: ["transactions:write", "planning:write"],
          maxRole: "owner",
        }),
      );
      const [row] = await withHousehold(t.app, hA, (tx) =>
        tx.select().from(schema.apiTokens).where(eq(schema.apiTokens.id, id)),
      );
      expect(row?.maxRole).toBe("member"); // capped at the creator's role

      await t.admin
        .update(schema.householdMembers)
        .set({ role: "viewer" })
        .where(eq(schema.householdMembers.userId, userId));
      const demoted = await authenticateToken(t.app, mt);
      expect(demoted).toMatchObject({ role: "viewer", scopes: ["read"] });

      // Only the owner sees other members' tokens; members can't revoke the owner's.
      const mine = await withHousehold(t.app, hA, (tx) => listApiTokens(tx, member));
      expect(mine.every((x) => x.userId === userId)).toBe(true);
      const all = await withHousehold(t.app, hA, (tx) => listApiTokens(tx, owner));
      expect(all.some((x) => x.userId === owner.userId)).toBe(true);
      expect(await withHousehold(t.app, hA, (tx) => revokeApiToken(tx, member, tokenId))).toBe(
        false,
      );

      await t.admin
        .delete(schema.householdMembers)
        .where(eq(schema.householdMembers.userId, userId));
      expect(await authenticateToken(t.app, mt)).toBeNull();
    });

    it("viewer tokens never carry write scopes", async () => {
      const viewer = { ...owner, role: "viewer" as const };
      const r = await withHousehold(t.app, hA, (tx) =>
        createApiToken(tx, viewer, { name: "v", scopes: [...SCOPES] }),
      );
      expect(await authenticateToken(t.app, r.token)).toMatchObject({
        role: "viewer",
        scopes: ["read"],
      });
    });

    it("stays inside the token's household", async () => {
      const rb = await withHousehold(t.app, hB, (tx) =>
        createApiToken(tx, ownerB, { name: "b", scopes: ["transactions:write"] }),
      );
      const pb = (await authenticateToken(t.app, rb.token)) as Principal;
      expect(pb.householdId).toBe(hB);
      // Household A can't see B's token rows at all.
      const visible = await withHousehold(t.app, hA, (tx) =>
        tx.select().from(schema.apiTokens).where(eq(schema.apiTokens.id, rb.id)),
      );
      expect(visible).toHaveLength(0);
      const fromB = await execute(t.app, pb, searchTransactions, {
        start: "2026-01-01",
        end: "2026-06-30",
        limit: 100,
      });
      const aIds = await withHousehold(t.app, hA, (tx) =>
        tx
          .select({ id: schema.transactions.id })
          .from(schema.transactions)
          .where(and(isNull(schema.transactions.splitParentId), sql`true`)),
      );
      const aSet = new Set(aIds.map((x) => x.id));
      expect(fromB.some((x) => aSet.has(x.id))).toBe(false);
    });

    it("the app role can't read token hashes without a household scope", async () => {
      expect(await t.app.select().from(schema.apiTokens)).toHaveLength(0);
    });
  });
});
