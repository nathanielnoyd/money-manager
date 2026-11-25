/**
 * `node dist/recover.mjs [email] [--remove-totp]` (in Docker: `docker compose run --rm migrate
 * node dist/recover.mjs`), or `pnpm recover-access` in development. See recover.ts.
 */
import { createDb, createPool, readSecret } from "@mm/db";
import { RecoverError, recoverAccess } from "./recover";

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"));
const removeTotp = args.includes("--remove-totp");
const host = process.env.DATABASE_HOST ?? "db";
const name = process.env.DATABASE_NAME ?? "money_manager";
const adminUrl =
  readSecret("DATABASE_ADMIN_URL") ??
  `postgres://mm_admin:${encodeURIComponent(readSecret("POSTGRES_ADMIN_PASSWORD", true))}@${host}:5432/${name}`;

const pool = createPool(adminUrl, 1);
try {
  const r = await recoverAccess(createDb(pool), { email, removeTotp });
  console.log(
    `New recovery codes for ${r.email} (each works once; the old ones no longer work):\n`,
  );
  for (const c of r.codes) console.log(`  ${c}`);
  console.log(
    `\nOpen the sign-in page, choose "Use a recovery code", and enter ${r.email} and one code.` +
      "\nYou will be asked to create a new passkey straight away.",
  );
  if (r.totpRemoved) console.log("The authenticator app was removed from this account.");
  if (r.totpRequired)
    console.log(
      "This account has an authenticator app: you will need its 6-digit code too. If that" +
        "\ndevice is also lost, run this again with --remove-totp.",
    );
} catch (e) {
  if (!(e instanceof RecoverError)) throw e;
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
