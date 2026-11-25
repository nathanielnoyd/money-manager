import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type KeyPair, parseKeyring } from "@mm/crypto";
import { readSecret } from "@mm/db";

function databaseUrl(): string {
  const direct = readSecret("DATABASE_URL");
  if (direct) return direct;
  const password = readSecret("APP_DB_PASSWORD", true);
  const host = process.env.DATABASE_HOST ?? "db";
  const name = process.env.DATABASE_NAME ?? "money_manager";
  return `postgres://mm_app:${encodeURIComponent(password)}@${host}:5432/${name}`;
}

export interface WorkerConfig {
  databaseUrl: string;
  /** Private keys that open aggregator secrets. Only the worker ever holds these. */
  keyring: KeyPair[];
  syncCron: string;
  /** Hours between syncs of one connection. SimpleFIN Bridge allows about 24 requests/day. */
  syncIntervalHours: number;
  heartbeatFile: string;
}

export function loadConfig(): WorkerConfig {
  return {
    databaseUrl: databaseUrl(),
    keyring: parseKeyring(readSecret("WORKER_KEYS", true)),
    syncCron: process.env.SYNC_CRON ?? "*/15 * * * *",
    syncIntervalHours: Math.max(1, Number(process.env.SYNC_INTERVAL_HOURS ?? 6)),
    heartbeatFile: process.env.HEARTBEAT_FILE ?? defaultHeartbeatFile(),
  };
}

/**
 * Outside the container (where the image sets HEARTBEAT_FILE on its private tmpfs), keep the
 * heartbeat in a directory only this user can read, not at a guessable path in a shared /tmp.
 */
function defaultHeartbeatFile(): string {
  return join(mkdtempSync(join(tmpdir(), "mm-worker-")), "heartbeat");
}
