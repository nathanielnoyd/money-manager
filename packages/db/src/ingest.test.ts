import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withHousehold } from "./client";
import { applyRulesToExisting, ingestTransactions, upsertProviderAccounts } from "./ingest";
import {
  accounts,
  balanceSnapshots,
  categories,
  connections,
  merchants,
  rules,
  transactions,
} from "./schema";
import { createTestDatabase, type TestDatabase, testDatabaseUrl } from "./testing";

const adminUrl = testDatabaseUrl();

describe.skipIf(!adminUrl)("ingest (integration)", () => {
  let t: TestDatabase;
  let h: string;
  let connId: string;
  let card: string;
  let checking: string;
  let catId: (name: string) => Promise<string>;

  beforeAll(async () => {
    t = await createTestDatabase(adminUrl as string);
    h = await t.household();
    catId = async (name) =>
      withHousehold(t.app, h, async (tx) => {
        const [c] = await tx.select().from(categories).where(eq(categories.name, name));
        return c?.id as string;
      });
    await withHousehold(t.app, h, async (tx) => {
      const [c] = await tx
        .insert(connections)
        .values({ householdId: h, provider: "simplefin", institutionName: "Test" })
        .returning();
      connId = c?.id as string;
      const map = await upsertProviderAccounts(tx, h, connId, [
        {
          providerAccountId: "card",
          name: "Visa 1107",
          type: "credit",
          currency: "USD",
          balance: -123456,
        },
        {
          providerAccountId: "chk",
          name: "Checking",
          type: "depository",
          currency: "USD",
          balance: 500000,
          availableBalance: 490000,
        },
      ]);
      card = map.get("card") as string;
      checking = map.get("chk") as string;
    });
  });
  afterAll(() => t?.cleanup());

  it("stores liabilities as amount owed and snapshots balances", async () => {
    await withHousehold(t.app, h, async (tx) => {
      const [c] = await tx.select().from(accounts).where(eq(accounts.id, card));
      expect(c?.currentBalance).toBe(123456);
      expect(await tx.select().from(balanceSnapshots)).toHaveLength(2);
    });
  });

  it("keeps the user's account type and name on later syncs", async () => {
    await withHousehold(t.app, h, async (tx) => {
      await tx
        .update(accounts)
        .set({ name: "My Checking", type: "depository" })
        .where(eq(accounts.id, checking));
      await upsertProviderAccounts(tx, h, connId, [
        {
          providerAccountId: "chk",
          name: "CHECKING ...0001",
          type: "credit",
          currency: "USD",
          balance: 510000,
        },
      ]);
      const [a] = await tx.select().from(accounts).where(eq(accounts.id, checking));
      expect(a).toMatchObject({
        name: "My Checking",
        type: "depository",
        currentBalance: 510000,
        officialName: "CHECKING ...0001",
      });
    });
  });

  it("cleans merchants, applies rules, and dedupes on re-ingest", async () => {
    const subs = await catId("Subscriptions");
    await withHousehold(t.app, h, async (tx) => {
      await tx.insert(rules).values({
        householdId: h,
        name: "Netflix",
        conditions: [{ field: "merchant", op: "equals", value: "netflix" }],
        actions: { setCategoryId: subs, markReviewed: true },
      });
      const batch = [
        {
          accountId: card,
          providerTransactionId: "t1",
          date: "2026-03-03",
          amount: -1549,
          pending: false,
          description: "NETFLIX.COM",
        },
        {
          accountId: card,
          providerTransactionId: "t2",
          date: "2026-03-04",
          amount: -650,
          pending: false,
          description: "SQ *BLUE BOTTLE OAKLAND CA",
        },
      ];
      expect(await ingestTransactions(tx, h, batch)).toEqual({ added: 2, modified: 0, removed: 0 });
      expect(await ingestTransactions(tx, h, batch)).toEqual({ added: 0, modified: 0, removed: 0 });
      const rows = await tx
        .select({
          pid: transactions.providerTransactionId,
          cat: transactions.categoryId,
          reviewed: transactions.reviewed,
          merchant: merchants.name,
        })
        .from(transactions)
        .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
        .orderBy(transactions.providerTransactionId);
      expect(rows).toEqual([
        { pid: "t1", cat: subs, reviewed: true, merchant: "Netflix" },
        { pid: "t2", cat: null, reviewed: false, merchant: "Blue Bottle" },
      ]);
    });
  });

  it("replaces a pending transaction with its posted version and keeps user edits", async () => {
    const coffee = await catId("Coffee");
    await withHousehold(t.app, h, async (tx) => {
      await ingestTransactions(tx, h, [
        {
          accountId: card,
          providerTransactionId: "p1",
          date: "2026-03-10",
          amount: -475,
          pending: true,
          description: "STARBUCKS",
        },
      ]);
      await tx
        .update(transactions)
        .set({ categoryId: coffee, notes: "with Sam" })
        .where(eq(transactions.providerTransactionId, "p1"));

      const r = await ingestTransactions(
        tx,
        h,
        [
          {
            accountId: card,
            providerTransactionId: "x9",
            date: "2026-03-12",
            amount: -475,
            pending: false,
            description: "STARBUCKS STORE 0912",
          },
        ],
        { pruneMissingPending: { accountIds: [card], start: "2026-01-01" } },
      );
      expect(r).toEqual({ added: 1, modified: 0, removed: 1 });
      const [posted] = await tx
        .select()
        .from(transactions)
        .where(eq(transactions.providerTransactionId, "x9"));
      expect(posted).toMatchObject({ pending: false, categoryId: coffee, notes: "with Sam" });
      expect(
        await tx.select().from(transactions).where(eq(transactions.providerTransactionId, "p1")),
      ).toHaveLength(0);
    });
  });

  it("updates provider fields on changed rows without touching user fields", async () => {
    await withHousehold(t.app, h, async (tx) => {
      await tx
        .update(transactions)
        .set({ notes: "keep me" })
        .where(eq(transactions.providerTransactionId, "t2"));
      const r = await ingestTransactions(tx, h, [
        {
          accountId: card,
          providerTransactionId: "t2",
          date: "2026-03-05",
          amount: -700,
          pending: false,
          description: "SQ *BLUE BOTTLE OAKLAND CA",
        },
      ]);
      expect(r.modified).toBe(1);
      const [row] = await tx
        .select()
        .from(transactions)
        .where(eq(transactions.providerTransactionId, "t2"));
      expect(row).toMatchObject({ amount: -700, date: "2026-03-05", notes: "keep me" });
    });
  });

  it("uses provider merchant names and explicit pending→posted links (Plaid style)", async () => {
    const groceries = await catId("Groceries");
    await withHousehold(t.app, h, async (tx) => {
      await ingestTransactions(tx, h, [
        {
          accountId: checking,
          providerTransactionId: "pp1",
          date: "2026-03-20",
          amount: -8125,
          pending: true,
          description: "WHOLEFDS #10234 PENDING",
          merchantName: "Whole Foods Market",
        },
      ]);
      await tx
        .update(transactions)
        .set({ categoryId: groceries })
        .where(eq(transactions.providerTransactionId, "pp1"));
      // Posted version has a different amount (tip/adjustment), so only the explicit link can match it.
      const r = await ingestTransactions(
        tx,
        h,
        [
          {
            accountId: checking,
            providerTransactionId: "pp1-posted",
            date: "2026-03-21",
            amount: -8400,
            pending: false,
            description: "WHOLEFDS #10234",
            merchantName: "Whole Foods Market",
            pendingTransactionId: "pp1",
          },
        ],
        { removedProviderIds: { accountIds: [checking], ids: ["pp1"] } },
      );
      expect(r).toEqual({ added: 1, modified: 0, removed: 1 });
      const [row] = await tx
        .select({ cat: transactions.categoryId, merchant: merchants.name })
        .from(transactions)
        .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
        .where(eq(transactions.providerTransactionId, "pp1-posted"));
      expect(row).toEqual({ cat: groceries, merchant: "Whole Foods Market" });
    });
  });

  it("applies a new rule to existing transactions", async () => {
    const coffee = await catId("Coffee");
    await withHousehold(t.app, h, async (tx) => {
      const [rule] = await tx
        .insert(rules)
        .values({
          householdId: h,
          name: "Blue Bottle",
          conditions: [{ field: "description", op: "contains", value: "blue bottle" }],
          actions: { setCategoryId: coffee },
        })
        .returning();
      expect(await applyRulesToExisting(tx, { ruleId: rule?.id })).toBe(1);
      const [row] = await tx
        .select()
        .from(transactions)
        .where(eq(transactions.providerTransactionId, "t2"));
      expect(row?.categoryId).toBe(coffee);
    });
  });
  describe("split transactions", () => {
    /** Ingest one checking transaction and split it 60/40 between two categories. */
    async function ingestAndSplit(pid: string, amount: number, pending: boolean) {
      const [groceries, coffee] = [await catId("Groceries"), await catId("Coffee")];
      return withHousehold(t.app, h, async (tx) => {
        await ingestTransactions(tx, h, [
          {
            accountId: checking,
            providerTransactionId: pid,
            date: "2026-05-02",
            amount,
            pending,
            description: `CORNER MARKET ${pid}`,
          },
        ]);
        const [parent] = await tx
          .select()
          .from(transactions)
          .where(eq(transactions.providerTransactionId, pid));
        const part = {
          householdId: h,
          accountId: checking,
          date: "2026-05-02",
          pending,
          rawDescription: `CORNER MARKET ${pid}`,
          splitParentId: parent?.id as string,
        };
        await tx.insert(transactions).values([
          { ...part, amount: (amount * 6) / 10, categoryId: groceries },
          { ...part, amount: (amount * 4) / 10, categoryId: coffee },
        ]);
        await tx
          .update(transactions)
          .set({ isSplit: true, categoryId: null })
          .where(eq(transactions.id, parent?.id as string));
        return parent?.id as string;
      });
    }
    const partsOf = (parentId: string) =>
      withHousehold(t.app, h, (tx) =>
        tx.select().from(transactions).where(eq(transactions.splitParentId, parentId)),
      );

    it("moves the parts to the posted transaction that replaces a pending one", async () => {
      const pendingId = await ingestAndSplit("s1-pending", -5000, true);
      await withHousehold(t.app, h, async (tx) => {
        await ingestTransactions(
          tx,
          h,
          [
            {
              accountId: checking,
              providerTransactionId: "s1-posted",
              date: "2026-05-04",
              amount: -5000,
              pending: false,
              description: "CORNER MARKET POSTED",
              pendingTransactionId: "s1-pending",
            },
          ],
          { removedProviderIds: { accountIds: [checking], ids: ["s1-pending"] } },
        );
      });
      expect(await partsOf(pendingId)).toHaveLength(0);
      const [posted] = await withHousehold(t.app, h, (tx) =>
        tx.select().from(transactions).where(eq(transactions.providerTransactionId, "s1-posted")),
      );
      expect(posted).toMatchObject({ isSplit: true, categoryId: null, amount: -5000 });
      const parts = await partsOf(posted?.id as string);
      expect(parts.map((x) => x.amount).sort((a, b) => a - b)).toEqual([-3000, -2000]);
      expect(parts.every((x) => x.date === "2026-05-04" && !x.pending)).toBe(true);
    });

    it("drops the split when the bank changes the amount", async () => {
      const id = await ingestAndSplit("s2", -4000, false);
      await withHousehold(t.app, h, (tx) =>
        ingestTransactions(tx, h, [
          {
            accountId: checking,
            providerTransactionId: "s2",
            date: "2026-05-02",
            amount: -4600,
            pending: false,
            description: "CORNER MARKET s2",
          },
        ]),
      );
      expect(await partsOf(id)).toHaveLength(0);
      const [row] = await withHousehold(t.app, h, (tx) =>
        tx.select().from(transactions).where(eq(transactions.id, id)),
      );
      expect(row).toMatchObject({ isSplit: false, amount: -4600, reviewed: false });
    });

    it("keeps the split, and its parts in step, when only the date changes", async () => {
      const id = await ingestAndSplit("s3", -1000, false);
      await withHousehold(t.app, h, (tx) =>
        ingestTransactions(tx, h, [
          {
            accountId: checking,
            providerTransactionId: "s3",
            date: "2026-05-03",
            amount: -1000,
            pending: false,
            description: "CORNER MARKET s3",
          },
        ]),
      );
      const parts = await partsOf(id);
      expect(parts).toHaveLength(2);
      expect(parts.every((x) => x.date === "2026-05-03")).toBe(true);
    });

    it("removes the parts when the bank removes the transaction", async () => {
      const id = await ingestAndSplit("s4", -2000, false);
      await withHousehold(t.app, h, (tx) =>
        ingestTransactions(tx, h, [], {
          removedProviderIds: { accountIds: [checking], ids: ["s4"] },
        }),
      );
      expect(await partsOf(id)).toHaveLength(0);
    });
  });
  it("files a card payment and its matching withdrawal as transfers, and leaves lookalikes", async () => {
    const [payment, transfer] = [await catId("Credit Card Payment"), await catId("Transfer")];
    const tx1 = (accountId: string, pid: string, amount: number, description: string) => ({
      accountId,
      providerTransactionId: pid,
      date: "2026-07-10",
      amount,
      pending: false,
      description,
    });
    await withHousehold(t.app, h, async (tx) => {
      // The card side arrives first; the checking side on a later sync.
      await ingestTransactions(tx, h, [tx1(card, "xf-card", 43210, "THANK YOU")]);
      await ingestTransactions(tx, h, [
        tx1(checking, "xf-chk", -43210, "CARDMEMBER SERV WEB"),
        // Same amount in and out of the same account: not a transfer.
        tx1(checking, "xf-same-out", -7700, "TRANSFER"),
        tx1(checking, "xf-same-in", 7700, "TRANSFER"),
      ]);
      const got = await tx
        .select({
          pid: transactions.providerTransactionId,
          cat: transactions.categoryId,
          source: transactions.categorySource,
          reviewed: transactions.reviewed,
        })
        .from(transactions)
        .where(sql`${transactions.providerTransactionId} like 'xf-%'`);
      const by = Object.fromEntries(got.map((g) => [g.pid, g]));
      expect(by["xf-card"]).toEqual({
        pid: "xf-card",
        cat: payment,
        source: "transfer",
        reviewed: false,
      });
      expect(by["xf-chk"]).toMatchObject({ cat: payment, source: "transfer" });
      expect(by["xf-same-out"]?.cat).toBeNull();
      expect(by["xf-same-in"]?.cat).toBeNull();
      expect(transfer).toBeTruthy();
    });
  });
});
