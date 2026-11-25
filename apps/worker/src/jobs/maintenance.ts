import { type Db, schema } from "@mm/db";
import { lt, sql } from "drizzle-orm";
import { log } from "../log";

export interface MaintenanceResult {
  sessions: number;
  challenges: number;
  staleRuns: number;
  syncRuns: number;
  aiUsage: number;
  notifications: number;
}

/**
 * Hourly housekeeping: expired sessions and WebAuthn challenges, plus old log rows and
 * abandoned sync runs across households (prune_logs(), see migration 0023).
 */
export async function runMaintenance(db: Db): Promise<MaintenanceResult> {
  const now = new Date();
  const sessions = await db
    .delete(schema.sessions)
    .where(lt(schema.sessions.expiresAt, now))
    .returning({ t: schema.sessions.tokenHash });
  const challenges = await db
    .delete(schema.authChallenges)
    .where(lt(schema.authChallenges.expiresAt, now))
    .returning({ id: schema.authChallenges.id });
  const { rows } = await db.execute<{
    stale_runs: number;
    sync_runs: number;
    ai_usage: number;
    notifications: number;
  }>(sql`select * from prune_logs()`);
  const pruned = rows[0];
  const result: MaintenanceResult = {
    sessions: sessions.length,
    challenges: challenges.length,
    staleRuns: pruned?.stale_runs ?? 0,
    syncRuns: pruned?.sync_runs ?? 0,
    aiUsage: pruned?.ai_usage ?? 0,
    notifications: pruned?.notifications ?? 0,
  };
  log.info(result, "maintenance: pruned expired rows");
  return result;
}
