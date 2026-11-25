import { createTestDatabase, type TestDatabase, testDatabaseUrl } from "@mm/db/testing";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startListener } from "./listener";
import { installPgBoss } from "./pgboss-install";
import { ensureQueue } from "./queues";

const adminUrl = testDatabaseUrl();

describe.skipIf(!adminUrl)("job queue and listener (integration)", () => {
  let t: TestDatabase;
  let boss: PgBoss;

  beforeAll(async () => {
    t = await createTestDatabase(adminUrl as string);
    await installPgBoss(t.adminPool, t.appRole);
    boss = new PgBoss({ connectionString: t.appUrl, schema: "pgboss" });
    boss.on("error", () => {});
    await boss.start();
  });
  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await t?.cleanup();
  });

  it("allows one waiting and one running sync per connection, never two of either", async () => {
    const q = "sync-test";
    await ensureQueue(boss, q, "stately");
    const send = (connectionId: string) =>
      boss.send(q, { connectionId }, { singletonKey: connectionId });

    expect(await send("a")).toBeTruthy();
    expect(await send("a")).toBeNull(); // already waiting
    expect(await send("b")).toBeTruthy(); // another connection is independent

    const running = await boss.fetch<{ connectionId: string }>(q, { batchSize: 10 });
    expect(running.map((j) => j.data.connectionId).sort()).toEqual(["a", "b"]);

    expect(await send("a")).toBeTruthy(); // one may wait behind the running sync
    expect(await send("a")).toBeNull();
    expect(await boss.fetch(q, { batchSize: 10 })).toHaveLength(0); // and it won't start alongside it
  });

  it("recreates a queue that an earlier version made without the policy", async () => {
    const q = "sync-upgrade";
    await boss.createQueue(q);
    expect((await boss.getQueue(q))?.policy).toBe("standard");
    await ensureQueue(boss, q, "stately");
    expect((await boss.getQueue(q))?.policy).toBe("stately");
    await ensureQueue(boss, q, "stately"); // idempotent
  });

  it("queues a household's scheduled job once per slot, even after it has finished", async () => {
    const q = "per-household-test";
    await ensureQueue(boss, q);
    const send = (householdId: string) =>
      boss.send(q, { householdId }, { singletonKey: householdId, singletonSeconds: 12 * 3600 });

    const first = await send("h1");
    expect(first).toBeTruthy();
    expect(await send("h2")).toBeTruthy();
    const [job] = await boss.fetch(q);
    await boss.complete(q, job?.id as string);
    expect(await send("h1")).toBeNull(); // the cron job ran again: nothing new for h1
    expect(await send("h2")).toBeNull();
  });

  it("keeps listening after its connection is killed", async () => {
    const got: string[] = [];
    let reconnected = 0;
    const listener = await startListener({
      connectionString: t.appUrl,
      channel: "mm_test",
      onNotification: (p) => got.push(p ?? ""),
      onReconnect: () => reconnected++,
      retryMs: 50,
    });
    const until = async (ok: () => boolean) => {
      for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 50));
      expect(ok()).toBe(true);
    };
    try {
      await t.adminPool.query("select pg_notify('mm_test', 'one')");
      await until(() => got.includes("one"));

      await t.adminPool.query(
        `select pg_terminate_backend(pid) from pg_stat_activity
         where usename = $1 and query ilike 'LISTEN%'`,
        [t.appRole],
      );
      await until(() => reconnected === 1);

      await t.adminPool.query("select pg_notify('mm_test', 'two')");
      await until(() => got.includes("two"));
    } finally {
      await listener.stop();
    }
  });
});
