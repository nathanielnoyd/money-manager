import { schema, withHousehold } from "@mm/db";
import { createTestDatabase, type TestDatabase, testDatabaseUrl } from "@mm/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMaintenance } from "./maintenance";

const adminUrl = testDatabaseUrl();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);

describe.skipIf(!adminUrl)("hourly maintenance (integration)", () => {
  let t: TestDatabase;
  let h: string;
  let connectionId: string;

  beforeAll(async () => {
    t = await createTestDatabase(adminUrl as string);
    h = await t.household();
    connectionId = await withHousehold(t.app, h, async (tx) => {
      const [c] = await tx
        .insert(schema.connections)
        .values({ householdId: h, provider: "simplefin", institutionName: "Bank" })
        .returning();
      return c?.id as string;
    });
  });
  afterAll(() => t?.cleanup());

  it("prunes old log rows and closes abandoned syncs, as the app role, across households", async () => {
    await withHousehold(t.app, h, async (tx) => {
      const run = { householdId: h, connectionId };
      await tx.insert(schema.syncRuns).values([
        { ...run, status: "success", startedAt: daysAgo(120), finishedAt: daysAgo(120) },
        { ...run, status: "success", startedAt: daysAgo(10), finishedAt: daysAgo(10) },
        { ...run, status: "running", startedAt: hoursAgo(3) },
        { ...run, status: "running", startedAt: hoursAgo(0.1) },
      ]);
      const usage = { householdId: h, feature: "ask", model: "m", inputTokens: 1, outputTokens: 1 };
      await tx.insert(schema.aiUsage).values([
        { ...usage, createdAt: daysAgo(500) },
        { ...usage, createdAt: daysAgo(20) },
      ]);
      await tx.insert(schema.notificationLog).values([
        { householdId: h, kind: "large_transaction", key: "old", sentAt: daysAgo(500) },
        { householdId: h, kind: "large_transaction", key: "new", sentAt: daysAgo(5) },
      ]);
    });

    // The worker's connection has no household scope: row-level security would hide these rows
    // from a plain DELETE, which is why pruning goes through prune_logs().
    const r = await runMaintenance(t.app);
    expect(r).toMatchObject({ staleRuns: 1, syncRuns: 1, aiUsage: 1, notifications: 1 });

    await withHousehold(t.app, h, async (tx) => {
      const runs = await tx.select().from(schema.syncRuns);
      expect(runs).toHaveLength(3);
      expect(runs.filter((x) => x.status === "running")).toHaveLength(1);
      const failed = runs.find((x) => x.status === "failed");
      expect(failed?.error).toMatch(/stopped before this sync finished/);
      expect(failed?.finishedAt).toBeTruthy();
      expect(await tx.select().from(schema.aiUsage)).toHaveLength(1);
      const keys = (await tx.select().from(schema.notificationLog)).map((n) => n.key);
      expect(keys).toEqual(["new"]);
    });

    expect(await runMaintenance(t.app)).toMatchObject({
      staleRuns: 0,
      syncRuns: 0,
      aiUsage: 0,
      notifications: 0,
    });
  });
});
