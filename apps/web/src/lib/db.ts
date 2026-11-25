import "server-only";
import { createDb, createPool, type Db } from "@mm/db";
import { env } from "./env";

const g = globalThis as unknown as { __mmDb?: Db };

/** Single pool per process (survives dev hot reloads). Connects as the RLS-bound `mm_app` role. */
export function db(): Db {
  g.__mmDb ??= createDb(createPool(env().databaseUrl, 10));
  return g.__mmDb;
}
