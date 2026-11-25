import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withHousehold } from "./client";
import { refreshRecurring } from "./recurring";
import { budgetItems, categories, goals, merchants, recurringSeries } from "./schema";
import { seedDemoData } from "./seed";
import { createTestDatabase, type TestDatabase, testDatabaseUrl } from "./testing";

const adminUrl = testDatabaseUrl();
const TODAY = "2026-06-30";

describe.skipIf(!adminUrl)("planning tables (integration)", () => {
  let t: TestDatabase;
  let hA: string;
  let hB: string;

  beforeAll(async () => {
    t = await createTestDatabase(adminUrl as string);
    hA = await t.household("A");
    hB = await t.household("B");
    await seedDemoData(t.app, hA, { months: 8, today: new Date(TODAY) });
  });
  afterAll(() => t?.cleanup());

  it("detects the demo household's subscriptions, bills and paycheck", async () => {
    const found = await withHousehold(t.app, hA, async (tx) => {
      await refreshRecurring(tx, hA, TODAY);
      return tx
        .select({
          merchant: merchants.name,
          cadence: recurringSeries.cadence,
          direction: recurringSeries.direction,
          amount: recurringSeries.expectedAmount,
        })
        .from(recurringSeries)
        .innerJoin(merchants, eq(merchants.id, recurringSeries.merchantId));
    });
    const by = new Map(found.map((f) => [`${f.merchant}|${f.direction}`, f]));
    expect(by.get("Netflix|out")).toMatchObject({ cadence: "monthly", amount: -1549 });
    expect(by.get("Spotify|out")).toMatchObject({ cadence: "monthly", amount: -1199 });
    expect(by.get("Acme Corp|in")).toMatchObject({ cadence: "biweekly", amount: 385042 });
    expect(by.get("Rocket Mortgage|out")).toMatchObject({ cadence: "monthly", amount: -245000 });
    // Irregular spending is not "recurring".
    expect(by.has("Amazon|out")).toBe(false);
    expect(by.has("Uber|out")).toBe(false);
    expect(by.has("Chevron|out")).toBe(false); // weekly gas varies: routine spending, not a bill
    // Transfers between your own accounts aren't bills or income.
    expect(by.has("Chase|out")).toBe(false);
    expect(by.has("Transfer|in")).toBe(false);
    expect(by.has("Acme Corp 401(k)|in")).toBe(false);
  });

  it("keeps a dismissed series dismissed when re-detecting", async () => {
    await withHousehold(t.app, hA, async (tx) => {
      const [netflix] = await tx.select().from(merchants).where(eq(merchants.name, "Netflix"));
      await tx
        .update(recurringSeries)
        .set({ status: "dismissed" })
        .where(eq(recurringSeries.merchantId, netflix?.id as string));
      await refreshRecurring(tx, hA, TODAY);
      const [row] = await tx
        .select()
        .from(recurringSeries)
        .where(eq(recurringSeries.merchantId, netflix?.id as string));
      expect(row?.status).toBe("dismissed");
    });
  });

  it("isolates budgets, recurring series and goals per household", async () => {
    await withHousehold(t.app, hA, async (tx) => {
      const [cat] = await tx.select().from(categories).where(eq(categories.name, "Groceries"));
      await tx.insert(budgetItems).values({
        householdId: hA,
        categoryId: cat?.id as string,
        month: "2026-06-01",
        amount: 60000,
      });
      await tx
        .insert(goals)
        .values({ householdId: hA, name: "Emergency fund", targetAmount: 1_000_000 });
    });
    const seenByB = await withHousehold(t.app, hB, async (tx) => ({
      budgets: await tx.select().from(budgetItems),
      recurring: await tx.select().from(recurringSeries),
      goals: await tx.select().from(goals),
    }));
    expect(seenByB).toEqual({ budgets: [], recurring: [], goals: [] });
    const err = await withHousehold(t.app, hB, (tx) =>
      tx.insert(goals).values({ householdId: hA, name: "sneaky", targetAmount: 1 }),
    ).catch((e: Error) => e);
    expect(String((err as Error).cause)).toMatch(/row-level security/);
  });

  it("seeds holdings that add up to each investment account's balance", async () => {
    await withHousehold(t.app, hA, async (tx) => {
      const { rows } = await tx.execute<{
        name: string;
        balance: string;
        held: string;
        n: number;
      }>(sql`
        select a.name, a.current_balance as balance, sum(h.value) as held, count(*)::int as n
        from accounts a join holdings h on h.account_id = a.id group by a.id`);
      expect(rows.length).toBe(2);
      for (const r of rows)
        expect(Math.abs(Number(r.balance) - Number(r.held))).toBeLessThanOrEqual(r.n);
    });
    const seenByB = await withHousehold(t.app, hB, (tx) =>
      tx.execute(sql`select count(*)::int as n from holdings`),
    );
    expect(seenByB.rows[0]).toEqual({ n: 0 });
  });

  it("find_invite() only returns the invite whose token hash is presented", async () => {
    const { rows } = await t.appPool.query("select * from find_invite('not-a-real-hash')");
    expect(rows).toEqual([]);
  });
});
