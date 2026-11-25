import { appTimeZone } from "@mm/core";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Either the pool-backed db or an open transaction (nested calls use savepoints). */
export type Executor = Db | Tx;

export interface PoolOptions {
  /**
   * Longest a single statement may run, in milliseconds; 0 for no limit. The default suits
   * the app and the worker. Migrations and the seed script pass 0.
   */
  statementTimeoutMs?: number;
}

export function createPool(connectionString: string, max = 10, opts: PoolOptions = {}): pg.Pool {
  const statementTimeout = opts.statementTimeoutMs ?? 60_000;
  const pool = new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    // Fail a request quickly when the database is unreachable, instead of hanging.
    connectionTimeoutMillis: 10_000,
    options: [
      // current_date, now()::date and date_trunc() in SQL use the same zone as todayIso().
      `-c TimeZone=${appTimeZone()}`,
      // A runaway query can't hold a connection forever.
      `-c statement_timeout=${statementTimeout}`,
      // Nor can a transaction left open while the code waits on something else. Network calls
      // (banks, Claude) are made with no transaction open, so a minute is generous.
      "-c idle_in_transaction_session_timeout=60000",
    ].join(" "),
  });
  // An idle client can be dropped by the server (restart, failover, admin action). Without a
  // listener that error would crash the process; the pool replaces the client on next use.
  pool.on("error", (err) => {
    if ((err as { code?: string }).code !== "57P01") console.warn(`postgres pool: ${err.message}`);
  });
  return pool;
}

export function createDb(pool: pg.Pool): Db {
  return drizzle({ client: pool, schema, casing: "snake_case" });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` in a transaction scoped to one household. Row-level security policies
 * restrict every household-scoped table to rows matching this id.
 */
export async function withHousehold<T>(
  db: Executor,
  householdId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(householdId)) throw new Error("withHousehold: invalid household id");
  return (db as Db).transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.household_id', ${householdId}, true)`);
    return fn(tx);
  });
}
