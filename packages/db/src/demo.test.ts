import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withHousehold } from "./client";
import { DemoRefusedError, demoHouseholdId, demoVisitor, resetDemo } from "./demo";
import { createTestDatabase, type TestDatabase, testDatabaseUrl } from "./testing";

const adminUrl = testDatabaseUrl();

describe.skipIf(!adminUrl)("demo mode (integration)", () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await createTestDatabase(adminUrl as string);
  });
  afterAll(() => t?.cleanup());

  it("builds a populated demo household with a read-only visitor, as the app role", async () => {
    const id = await resetDemo(t.app, "2026-06-30");
    expect(await demoHouseholdId(t.app)).toBe(id);
    const visitor = await demoVisitor(t.app);
    expect(visitor?.householdId).toBe(id);
    const { rows } = await t.app.execute<{ role: string }>(
      sql`select role from household_members where user_id = ${visitor?.userId}`,
    );
    expect(rows).toEqual([{ role: "viewer" }]);
    await withHousehold(t.app, id, async (tx) => {
      const counts = await tx.execute<{
        txns: number;
        budgets: number;
        goals: number;
        recurring: number;
        holdings: number;
      }>(sql`
        select (select count(*)::int from transactions) as txns, (select count(*)::int from budget_items) as budgets,
               (select count(*)::int from goals) as goals, (select count(*)::int from recurring_series) as recurring,
               (select count(*)::int from holdings) as holdings`);
      const c = counts.rows[0];
      expect(c?.txns).toBeGreaterThan(500);
      expect(c?.budgets).toBeGreaterThan(5);
      expect(c?.goals).toBe(2);
      expect(c?.recurring).toBeGreaterThan(3);
      expect(c?.holdings).toBeGreaterThan(3);
    });
  });

  it("replaces the previous demo household on reset", async () => {
    const first = await demoHouseholdId(t.app);
    const second = await resetDemo(t.app, "2026-07-01");
    expect(second).not.toBe(first);
    const { rows } = await t.app.execute<{ n: number }>(
      sql`select count(distinct household_id)::int as n from household_members`,
    );
    expect(rows[0]?.n).toBe(1);
  });

  it("refuses to run on a database with real households", async () => {
    await t.household("Real family");
    await expect(resetDemo(t.app)).rejects.toBeInstanceOf(DemoRefusedError);
  });
});
