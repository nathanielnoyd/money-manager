import { lstatSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { generateKeyPair, generateSecretKey } from "../index";

/** Create .env.development for local work (matches compose.dev.yml). Never overwrites. */
const path = resolve(process.env.INIT_CWD ?? process.cwd(), ".env.development");
const worker = await generateKeyPair();
try {
  // "wx" creates the file only if it doesn't exist, atomically: never overwrites.
  writeFileSync(
    path,
    `# Local development only (pnpm dev). Never use these values in production; production uses .env + ./secrets.
DATABASE_ADMIN_URL=postgres://mm_admin:dev-admin-password@localhost:5432/money_manager
APP_DB_PASSWORD=dev-app-password
DATABASE_URL=postgres://mm_app:dev-app-password@localhost:5432/money_manager
TEST_DATABASE_ADMIN_URL=postgres://mm_admin:dev-admin-password@localhost:5432/money_manager
APP_URL=http://localhost:3000
ACCESS_MODE=none
AUTH_ENCRYPTION_KEY=${await generateSecretKey()}
WORKER_PUBLIC_KEY=${worker.publicKey}
WORKER_KEYS=${JSON.stringify([worker])}
`,
    { mode: 0o600, flag: "wx" },
  );
  console.log("✓ wrote .env.development");
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  console.log(".env.development already exists; leaving it alone.");
}

// Next.js only reads env files from its own directory; link the shared dev env into apps/web.
const link = join(dirname(path), "apps/web/.env.development.local");
const exists = (() => {
  try {
    lstatSync(link);
    return true;
  } catch {
    return false;
  }
})();
if (!exists) {
  symlinkSync("../../.env.development", link);
  console.log("✓ linked apps/web/.env.development.local");
}
