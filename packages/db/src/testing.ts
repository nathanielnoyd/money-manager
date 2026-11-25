import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { createDb, createPool, type Db } from "./client";
import { createHousehold } from "./households";
import { runMigrations } from "./migrate";
import { users } from "./schema";

/**
 * The admin URL integration tests create their throwaway databases with. Without it, suites
 * skip on a developer's machine. In CI a missing URL is an error: a pipeline that loses the
 * variable must fail, not pass with every database test skipped.
 */
export function testDatabaseUrl(): string | undefined {
  const url = process.env.TEST_DATABASE_ADMIN_URL;
  if (!url && process.env.CI) {
    throw new Error("TEST_DATABASE_ADMIN_URL is not set, so integration tests cannot run in CI.");
  }
  return url || undefined;
}

/** A throwaway database + its own least-privileged role, for integration tests. */
export interface TestDatabase {
  admin: Db;
  app: Db;
  adminPool: pg.Pool;
  appPool: pg.Pool;
  appRole: string;
  /** Connection string for the least-privileged app role, for code that opens its own connections. */
  appUrl: string;
  /** Create a user + household as the app role; returns the household id. */
  household(name?: string): Promise<string>;
  cleanup(): Promise<void>;
}

export async function createTestDatabase(adminUrl: string): Promise<TestDatabase> {
  const dbName = `mm_test_${randomBytes(4).toString("hex")}`;
  const appRole = `${dbName}_app`;
  const appPassword = randomBytes(12).toString("hex");
  const root = createPool(adminUrl, 1);
  await root.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const adminPool = createPool(url.toString(), 2, { statementTimeoutMs: 0 });
  await runMigrations({
    adminPool,
    appPassword,
    appRole,
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    log: () => {},
  });
  url.username = appRole;
  url.password = appPassword;
  const appUrl = url.toString();
  const appPool = createPool(appUrl, 4);
  const admin = createDb(adminPool);
  const app = createDb(appPool);
  let n = 0;
  return {
    admin,
    app,
    adminPool,
    appPool,
    appRole,
    appUrl,
    async household(name = "Test") {
      n++;
      const [u] = await admin
        .insert(users)
        .values({
          email: `u${n}-${dbName}@example.test`,
          displayName: name,
          webauthnUserId: `${dbName}-${n}`,
        })
        .returning();
      return createHousehold(app, { name, ownerUserId: u?.id as string });
    },
    async cleanup() {
      await appPool.end();
      await adminPool.end();
      await root.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await root.query(`DROP ROLE IF EXISTS ${appRole}`);
      await root.end();
    },
  };
}
