import { DEFAULT_APP_ROLE } from "@mm/db";
import type pg from "pg";
import { getConstructionPlans } from "pg-boss";

export const PGBOSS_SCHEMA = "pgboss";

/**
 * Install pg-boss's tables as the app role without giving that role CREATE on the
 * database. The admin creates the schema (owned by mm_app), then assumes mm_app to
 * run pg-boss's construction SQL so every object is owned by the least-privileged role.
 * Later pg-boss version upgrades run as mm_app at worker start-up.
 */
export async function installPgBoss(
  adminPool: pg.Pool,
  appRole = DEFAULT_APP_ROLE,
): Promise<boolean> {
  const client = await adminPool.connect();
  try {
    const { rows } = await client.query<{ installed: boolean }>(
      `select to_regclass('${PGBOSS_SCHEMA}.version') is not null as installed`,
    );
    if (rows[0]?.installed) return false;
    const plan = getConstructionPlans(PGBOSS_SCHEMA).replace(
      new RegExp(`CREATE SCHEMA IF NOT EXISTS ${PGBOSS_SCHEMA};?`),
      "",
    );
    await client.query(`SET ROLE ${appRole}`);
    await client.query(plan);
    return true;
  } finally {
    await client.query("RESET ROLE").catch(() => {});
    client.release();
  }
}
