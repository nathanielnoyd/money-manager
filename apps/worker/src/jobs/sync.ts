import {
  type Connector,
  ConnectorError,
  createPlaidConnector,
  createSimpleFinConnector,
  createTellerConnector,
  type ProviderId,
} from "@mm/connectors";
import { type KeyPair, open, seal } from "@mm/crypto";
import {
  type Db,
  ingestTransactions,
  readSecret,
  refreshRecurring,
  replaceHoldings,
  schema,
  upsertProviderAccounts,
  withHousehold,
} from "@mm/db";
import { eq, sql } from "drizzle-orm";
import { log } from "../log";
import { aiAfterSync } from "./ai";
import { runAlerts } from "./alerts";

export const SYNC_QUEUE = "sync-connection";
export const NOTIFY_CHANNEL = "mm_sync";

export interface SyncJob {
  connectionId: string;
  householdId: string;
}

export interface SyncDeps {
  db: Db;
  keyring: KeyPair[];
  connectorFor: (provider: ProviderId) => Connector | undefined;
  intervalHours: number;
  now?: () => Date;
}

export function defaultConnectors(): (p: ProviderId) => Connector | undefined {
  const allowed = process.env.SIMPLEFIN_ALLOWED_HOSTS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const simplefin = createSimpleFinConnector({ allowedHostSuffixes: allowed });
  const plaidId = process.env.PLAID_CLIENT_ID;
  const plaidSecret = readSecret("PLAID_SECRET");
  const plaid =
    plaidId && plaidSecret
      ? createPlaidConnector({
          clientId: plaidId,
          secret: plaidSecret,
          env: process.env.PLAID_ENV === "production" ? "production" : "sandbox",
        })
      : undefined;
  const tellerEnv = process.env.TELLER_ENV as "sandbox" | "development" | "production" | undefined;
  let teller: Connector | undefined;
  if (process.env.TELLER_APPLICATION_ID && tellerEnv) {
    try {
      teller = createTellerConnector({
        env: tellerEnv,
        cert: readSecret("TELLER_CERT"),
        key: readSecret("TELLER_KEY"),
      });
    } catch (e) {
      // Misconfiguration shouldn't take down syncing for every other provider.
      log.error({ err: (e as Error).message }, "teller: disabled");
    }
  }
  return (p) =>
    p === "simplefin" ? simplefin : p === "plaid" ? plaid : p === "teller" ? teller : undefined;
}

/** Find connections due for a sync across households (ids only, via SECURITY DEFINER fn). */
export async function findDueConnections(db: Db, max = 100): Promise<SyncJob[]> {
  const { rows } = await db.execute<{ id: string; household_id: string }>(
    sql`select id, household_id from due_connections(${max})`,
  );
  return rows.map((r) => ({ connectionId: r.id, householdId: r.household_id }));
}

const UUID = /^[0-9a-f-]{36}$/i;
export function parseSyncPayload(payload: string | undefined): SyncJob | null {
  try {
    const p = JSON.parse(payload ?? "") as Partial<SyncJob>;
    return p.connectionId && p.householdId && UUID.test(p.connectionId) && UUID.test(p.householdId)
      ? { connectionId: p.connectionId, householdId: p.householdId }
      : null;
  } catch {
    return null;
  }
}

/**
 * Link (if needed) and sync one connection. Network calls happen outside DB
 * transactions; every write runs inside the connection's household RLS scope.
 * Secrets are decrypted only here, only in memory.
 */
export async function syncConnection(deps: SyncDeps, job: SyncJob): Promise<void> {
  const { db, keyring } = deps;
  const now = deps.now?.() ?? new Date();
  const startedAt = new Date(); // wall clock: rows inserted by this run have created_at >= startedAt
  const scoped = <T>(fn: Parameters<typeof withHousehold<T>>[2]) =>
    withHousehold(db, job.householdId, fn);

  const conn = await scoped(async (tx) => {
    const [c] = await tx
      .select()
      .from(schema.connections)
      .where(eq(schema.connections.id, job.connectionId));
    return c;
  });
  if (!conn || conn.status === "disconnected") return;
  // Until the one-time setup token has been exchanged, a transient failure must leave the
  // connection "linking": marking it active would make the next run use the token as a secret.
  let hasAccess = conn.status !== "linking";

  const [run] = await scoped((tx) =>
    tx
      .insert(schema.syncRuns)
      .values({ householdId: job.householdId, connectionId: conn.id })
      .returning({ id: schema.syncRuns.id }),
  );
  const finishRun = (
    status: string,
    counts: { added?: number; modified?: number; removed?: number },
    error: string | null,
  ) =>
    scoped((tx) =>
      tx
        .update(schema.syncRuns)
        .set({ status, error, finishedAt: new Date(), ...counts })
        .where(eq(schema.syncRuns.id, run?.id as string)),
    );

  const connector = deps.connectorFor(conn.provider as ProviderId);
  try {
    if (!connector)
      throw new ConnectorError(`Provider "${conn.provider}" isn't supported yet.`, "fatal");
    if (!conn.secretSealed)
      throw new ConnectorError("This connection has no stored credentials.", "reauth");

    let secret = await open(conn.secretSealed, keyring);
    if (conn.status === "linking") {
      // The stored secret is a one-time setup token: exchange it for long-lived access.
      const linked = await connector.completeLink(secret);
      secret = linked.secret;
      const resealed = await seal(secret, (keyring[0] as KeyPair).publicKey);
      await scoped((tx) =>
        tx
          .update(schema.connections)
          .set({
            secretSealed: resealed,
            status: "active",
            institutionName: linked.institutionName,
            lastError: null,
          })
          .where(eq(schema.connections.id, conn.id)),
      );
      hasAccess = true;
      log.info({ connectionId: conn.id }, "link: claimed access");
    }

    const result = await connector.sync({ secret, cursor: conn.cursor, now });
    secret = "";

    const counts = await scoped(async (tx) => {
      const idMap = await upsertProviderAccounts(tx, job.householdId, conn.id, result.accounts);
      const accountIds = [...idMap.values()];
      const incoming = result.transactions.flatMap((t) => {
        const accountId = idMap.get(t.providerAccountId);
        return accountId ? [{ ...t, accountId }] : [];
      });
      const r = await ingestTransactions(tx, job.householdId, incoming, {
        pruneMissingPending: result.window ? { accountIds, start: result.window.start } : undefined,
        removedProviderIds: result.removed.length ? { accountIds, ids: result.removed } : undefined,
      });
      await tx
        .update(schema.connections)
        .set({
          status: "active",
          cursor: result.nextCursor ?? conn.cursor,
          lastSyncedAt: now,
          nextSyncAt: new Date(now.getTime() + deps.intervalHours * 3_600_000),
          lastError: result.warnings.length ? result.warnings.join(" · ") : null,
        })
        .where(eq(schema.connections.id, conn.id));
      if (result.holdings) {
        const holdingsIn = result.holdings.flatMap((h) => {
          const accountId = idMap.get(h.providerAccountId);
          return accountId ? [{ ...h, accountId }] : [];
        });
        const investmentAccounts = result.accounts
          .filter((a) => a.type === "investment")
          .flatMap((a) => idMap.get(a.providerAccountId) ?? []);
        await replaceHoldings(tx, job.householdId, investmentAccounts, holdingsIn);
      }
      if (r.added > 0 || r.removed > 0)
        await refreshRecurring(tx, job.householdId, now.toISOString().slice(0, 10));
      return r;
    });
    await finishRun("success", counts, null);
    if (counts.added > 0) await aiAfterSync(db, job.householdId, startedAt);
    await runAlerts(db, job.householdId, startedAt, { now });
    log.info({ connectionId: conn.id, ...counts, accounts: result.accounts.length }, "sync: done");
  } catch (err) {
    const ce = err instanceof ConnectorError ? err : null;
    const message = ce?.message ?? "Unexpected error while syncing. Check the worker logs.";
    const status =
      ce?.kind === "reauth"
        ? "needs_reauth"
        : ce?.kind === "fatal"
          ? "error"
          : hasAccess
            ? "active"
            : "linking";
    await scoped((tx) =>
      tx
        .update(schema.connections)
        .set({ status, lastError: message, nextSyncAt: new Date(now.getTime() + 3_600_000) })
        .where(eq(schema.connections.id, conn.id)),
    );
    await finishRun("failed", {}, message);
    if (status !== "active") await runAlerts(db, job.householdId, startedAt, { now });
    log.warn(
      { connectionId: conn.id, kind: ce?.kind ?? "unexpected", err: ce ? undefined : String(err) },
      "sync: failed",
    );
    if (!ce || ce.kind === "retry") throw err; // let pg-boss retry transient failures
  }
}
