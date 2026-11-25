import { migrate } from "drizzle-orm/node-postgres/migrator";
import type pg from "pg";
import { createDb } from "./client";
import { hasAnyUser, issueSetupToken } from "./setup-token";

export const DEFAULT_APP_ROLE = "mm_app";

export interface MigrateOptions {
  /** Pool connected as the database owner / superuser. */
  adminPool: pg.Pool;
  /** Password the least-privileged app role should use. */
  appPassword: string;
  migrationsFolder: string;
  /** Role name; roles are cluster-wide, so tests use their own. Default `mm_app`. */
  appRole?: string;
  log?: (msg: string) => void;
}

/**
 * Idempotent: ensure the app role, apply migrations, (re)grant privileges, and
 * print a first-run setup token if no user exists yet.
 */
export async function runMigrations(opts: MigrateOptions): Promise<void> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const APP_ROLE = opts.appRole ?? DEFAULT_APP_ROLE;
  if (!/^[a-z_][a-z0-9_]*$/.test(APP_ROLE)) throw new Error("invalid role name");
  const client = await opts.adminPool.connect();
  try {
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        CREATE ROLE ${APP_ROLE} LOGIN;
      END IF; END $$;`);
    await client.query(
      `ALTER ROLE ${APP_ROLE} WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ${client.escapeLiteral(opts.appPassword)}`,
    );
  } finally {
    client.release();
  }

  const db = createDb(opts.adminPool);
  await migrate(db, { migrationsFolder: opts.migrationsFolder });
  log("✓ migrations applied");

  await opts.adminPool.query(`
    REVOKE ALL ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
    GRANT EXECUTE ON FUNCTION app_household_id() TO ${APP_ROLE};
    GRANT EXECUTE ON FUNCTION due_connections(integer) TO ${APP_ROLE};
    GRANT EXECUTE ON FUNCTION find_invite(text) TO ${APP_ROLE};
    GRANT EXECUTE ON FUNCTION digest_households() TO ${APP_ROLE};
    GRANT EXECUTE ON FUNCTION find_api_token(text) TO ${APP_ROLE};
    GRANT EXECUTE ON FUNCTION catalog_refresh_households() TO ${APP_ROLE};
    GRANT EXECUTE ON FUNCTION prune_logs() TO ${APP_ROLE};
    REVOKE UPDATE, DELETE ON audit_log FROM ${APP_ROLE};
    REVOKE DELETE ON catalog_changes FROM ${APP_ROLE};
    CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION ${APP_ROLE};
  `);
  log(`✓ privileges granted to ${APP_ROLE}`);

  if (!(await hasAnyUser(db))) {
    const token = await issueSetupToken(db);
    log("");
    log("┌──────────────────────────────────────────────────────────────────┐");
    log("│  First-run setup                                                 │");
    log("│  Open the app and enter this one-time setup token (valid 24h):   │");
    log(`│  ${token.padEnd(64)}│`);
    log("└──────────────────────────────────────────────────────────────────┘");
    log("");
  }
}
