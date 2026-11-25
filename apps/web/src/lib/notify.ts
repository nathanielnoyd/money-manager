import "server-only";
import type { Tx } from "@mm/db";
import { sql } from "drizzle-orm";

/** Ask the worker to link/sync a connection now (delivered via Postgres LISTEN/NOTIFY). */
export async function requestSync(
  tx: Tx,
  householdId: string,
  connectionId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_notify('mm_sync', ${JSON.stringify({ connectionId, householdId })})`,
  );
}
