/** One-shot `migrate` service (and `pnpm db:migrate` in development). */
import { fileURLToPath } from "node:url";
import { createPool, readSecret, runMigrations } from "@mm/db";
import { installPgBoss } from "./pgboss-install";

const host = process.env.DATABASE_HOST ?? "db";
const name = process.env.DATABASE_NAME ?? "money_manager";
const adminUrl =
  readSecret("DATABASE_ADMIN_URL") ??
  `postgres://mm_admin:${encodeURIComponent(readSecret("POSTGRES_ADMIN_PASSWORD", true))}@${host}:5432/${name}`;

const adminPool = createPool(adminUrl, 2, { statementTimeoutMs: 0 });
try {
  await runMigrations({
    adminPool,
    appPassword: readSecret("APP_DB_PASSWORD", true),
    migrationsFolder:
      process.env.MIGRATIONS_DIR ??
      fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)),
  });
  if (await installPgBoss(adminPool)) console.log("✓ job queue installed");
} finally {
  await adminPool.end();
}
