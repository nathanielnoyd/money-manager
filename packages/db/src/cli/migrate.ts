import { fileURLToPath } from "node:url";
import { createPool } from "../client";
import { runMigrations } from "../migrate";
import { readSecret } from "../secrets";

const adminPool = createPool(readSecret("DATABASE_ADMIN_URL", true), 2, { statementTimeoutMs: 0 });
try {
  await runMigrations({
    adminPool,
    appPassword: readSecret("APP_DB_PASSWORD", true),
    migrationsFolder:
      process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
} finally {
  await adminPool.end();
}
