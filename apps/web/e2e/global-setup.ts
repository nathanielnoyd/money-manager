import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb, createPool, issueSetupToken, runMigrations } from "@mm/db";
import { E2E } from "../playwright.config";
import { startFakeAnthropic } from "./fake-anthropic";

export const STATE_DIR = fileURLToPath(new URL("./.state", import.meta.url));

export default async function globalSetup() {
  const root = createPool(
    Object.assign(new URL(E2E.adminUrl), { pathname: "/postgres" }).toString(),
    1,
  );
  await root.query("DROP DATABASE IF EXISTS mm_e2e WITH (FORCE)");
  await root.query("CREATE DATABASE mm_e2e");
  await root.end();

  const admin = createPool(E2E.adminUrl, 2, { statementTimeoutMs: 0 });
  await runMigrations({
    adminPool: admin,
    appRole: E2E.appRole,
    appPassword: E2E.appPassword,
    migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)),
    log: () => {},
  });
  const token = await issueSetupToken(createDb(admin));
  await admin.end();
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(`${STATE_DIR}/setup-token`, token);

  // Stand-in Anthropic API for the AI features (see fake-anthropic.ts).
  const fake = await startFakeAnthropic();
  return () => new Promise<void>((resolve) => fake.close(() => resolve()));
}
