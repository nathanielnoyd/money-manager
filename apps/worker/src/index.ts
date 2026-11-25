import { writeFileSync } from "node:fs";
import { appTimeZone } from "@mm/core";
import { open, seal } from "@mm/crypto";
import { createDb, createPool, demoHouseholdId, resetDemo } from "@mm/db";
import { PgBoss } from "pg-boss";
import { loadConfig } from "./config";
import { digestHouseholds, weeklyDigestFor, workerAi } from "./jobs/ai";
import { catalogRefreshFor, catalogRefreshHouseholds } from "./jobs/catalog-refresh";
import { runMaintenance } from "./jobs/maintenance";
import {
  defaultConnectors,
  findDueConnections,
  NOTIFY_CHANNEL,
  parseSyncPayload,
  SYNC_QUEUE,
  type SyncDeps,
  type SyncJob,
  syncConnection,
} from "./jobs/sync";
import { startListener } from "./listener";
import { log } from "./log";
import { ensureQueue } from "./queues";

const SCHEDULER_QUEUE = "sync-scheduler";
const MAINTENANCE_QUEUE = "maintenance";
const DIGEST_QUEUE = "weekly-digest";
const CATALOG_QUEUE = "catalog-refresh";
// The two scheduled AI jobs only list households; each household is its own job, so a slow
// or failing one can't make the whole run expire and start again for everybody.
const DIGEST_HOUSEHOLD_QUEUE = "weekly-digest-household";
const CATALOG_HOUSEHOLD_QUEUE = "catalog-refresh-household";
/** A household gets at most one of each job per 12-hour slot, however often the cron job re-runs. */
const ONCE_PER_RUN = { singletonSeconds: 12 * 3600 };

const config = loadConfig();

// Fail fast if the keyring can't actually open sealed secrets (bad or mismatched keys).
for (const kp of config.keyring) {
  if ((await open(await seal("self-test", kp.publicKey), [kp])) !== "self-test") {
    throw new Error(`keyring self-test failed for kid ${kp.kid}`);
  }
}

const pool = createPool(config.databaseUrl, 5);
const db = createDb(pool);
const deps: SyncDeps = {
  db,
  keyring: config.keyring,
  connectorFor: defaultConnectors(),
  intervalHours: config.syncIntervalHours,
};
const boss = new PgBoss({
  connectionString: config.databaseUrl,
  schema: "pgboss",
  application_name: "mm-worker",
});
boss.on("error", (err) => log.error({ err: err.message }, "pg-boss error"));

await boss.start({ attempts: 10 });
for (const q of [
  SCHEDULER_QUEUE,
  MAINTENANCE_QUEUE,
  DIGEST_QUEUE,
  DIGEST_HOUSEHOLD_QUEUE,
  CATALOG_QUEUE,
  CATALOG_HOUSEHOLD_QUEUE,
])
  await ensureQueue(boss, q);
// "stately": per connection, at most one sync running and one waiting. Without a queue policy
// pg-boss ignores singletonKey, and the same connection could sync twice at once.
await ensureQueue(boss, SYNC_QUEUE, "stately");
// Cron expressions are read in the instance's time zone (TZ, or UTC).
const inZone = { tz: appTimeZone() };
await boss.schedule(SCHEDULER_QUEUE, config.syncCron, null, inZone);
await boss.schedule(MAINTENANCE_QUEUE, "17 * * * *", null, inZone);
// Monday morning digest. Only households that opted in get one.
await boss.schedule(DIGEST_QUEUE, process.env.DIGEST_CRON ?? "0 8 * * 1", null, inZone);
// Monthly card catalog check, for households that turned it on under Settings → AI.
await boss.schedule(CATALOG_QUEUE, process.env.CATALOG_REFRESH_CRON ?? "0 9 3 * *", null, inZone);

const enqueue = (job: SyncJob) =>
  boss.send(SYNC_QUEUE, job, { singletonKey: job.connectionId, retryLimit: 3, retryBackoff: true });

await boss.work(SCHEDULER_QUEUE, async () => {
  const due = await findDueConnections(db);
  for (const job of due) await enqueue(job);
  log.info({ queued: due.length }, "scheduler: queued due connections");
});
await boss.work<SyncJob>(SYNC_QUEUE, async (jobs) => {
  for (const job of jobs) await syncConnection(deps, job.data);
});
await boss.work(MAINTENANCE_QUEUE, () => runMaintenance(db));
await boss.work(DIGEST_QUEUE, async () => {
  const ids = workerAi() ? await digestHouseholds(db) : [];
  for (const householdId of ids)
    await boss.send(
      DIGEST_HOUSEHOLD_QUEUE,
      { householdId },
      { ...ONCE_PER_RUN, singletonKey: householdId, retryLimit: 1, expireInSeconds: 10 * 60 },
    );
  log.info({ households: ids.length }, "digest: queued weekly run");
});
await boss.work<{ householdId: string }>(DIGEST_HOUSEHOLD_QUEUE, async (jobs) => {
  for (const job of jobs) await weeklyDigestFor(db, job.data.householdId);
});
await boss.work(CATALOG_QUEUE, async () => {
  const ids = workerAi() ? await catalogRefreshHouseholds(db) : [];
  for (const householdId of ids)
    await boss.send(
      CATALOG_HOUSEHOLD_QUEUE,
      { householdId },
      // No retry: a second attempt would pay for the same checks again. Next month's run
      // picks up whatever is still stale. Up to 7 entries, each a multi-turn web check.
      { ...ONCE_PER_RUN, singletonKey: householdId, retryLimit: 0, expireInSeconds: 90 * 60 },
    );
  log.info({ households: ids.length }, "catalog refresh: queued monthly run");
});
await boss.work<{ householdId: string }>(CATALOG_HOUSEHOLD_QUEUE, async (jobs) => {
  for (const job of jobs) {
    const r = await catalogRefreshFor(db, job.data.householdId);
    log.info(
      { householdId: job.data.householdId, ...r, names: undefined },
      "catalog refresh: done",
    );
  }
});

// Public demo (DEMO_MODE=1): build the demo household now if missing, then rebuild nightly
// so dates stay current and visitors always see a clean copy.
if (process.env.DEMO_MODE === "1") {
  const DEMO_QUEUE = "demo-reset";
  const reset = async () => {
    const id = await resetDemo(db);
    log.info({ householdId: id }, "demo: reset");
  };
  try {
    if (!(await demoHouseholdId(db))) await reset();
  } catch (e) {
    log.fatal({ err: (e as Error).message }, "demo: refusing to start");
    process.exit(1);
  }
  await boss.createQueue(DEMO_QUEUE);
  await boss.schedule(DEMO_QUEUE, process.env.DEMO_RESET_CRON ?? "0 4 * * *", null, inZone);
  await boss.work(DEMO_QUEUE, reset);
}

// "Link" / "Sync now" from the web app arrive as NOTIFY mm_sync '<json>'. A notification sent
// while the listener is away is lost, so after each reconnect queue whatever is due: both
// actions set next_sync_at to now.
const queueDue = async () => {
  for (const job of await findDueConnections(db)) await enqueue(job);
};
const listener = await startListener({
  connectionString: config.databaseUrl,
  channel: NOTIFY_CHANNEL,
  onNotification: (payload) => {
    const job = parseSyncPayload(payload);
    if (job) void enqueue(job).catch((e) => log.error({ err: String(e) }, "enqueue failed"));
  },
  onLost: (reason) => log.warn({ err: reason }, "listener lost; reconnecting"),
  onReconnect: () => {
    log.info("listener reconnected");
    void queueDue().catch((e) => log.error({ err: String(e) }, "catch-up after reconnect failed"));
  },
});

// Liveness: Docker's healthcheck looks at this file's age.
const beat = () => writeFileSync(config.heartbeatFile, String(Date.now()), { mode: 0o600 });
beat();
const heartbeat = setInterval(beat, 30_000);

log.info(
  {
    syncCron: config.syncCron,
    intervalHours: config.syncIntervalHours,
    keys: config.keyring.length,
    timeZone: appTimeZone(),
  },
  "worker started",
);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, "worker stopping");
  clearInterval(heartbeat);
  await listener.stop();
  await boss.stop({ graceful: true, timeout: 20_000 });
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
