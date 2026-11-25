import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { generateKeyPair, generateSecretKey } from "../index";

/**
 * Generate every secret a production instance needs, as individual files for
 * Docker secrets. Existing files are never overwritten.
 *
 *   pnpm keys:generate            # → ./secrets
 *   pnpm keys:generate --out /srv/money-manager/secrets
 *
 * The directory is created 0700 (only you can enter it). Files are 0644 so the
 * non-root container users can read them when bind-mounted.
 */
const { values } = parseArgs({ options: { out: { type: "string" } } });
const outDir = resolve(process.env.INIT_CWD ?? process.cwd(), values.out ?? "secrets");
mkdirSync(outDir, { recursive: true, mode: 0o700 });
chmodSync(outDir, 0o700);

if (existsSync(join(outDir, "worker_keys")) !== existsSync(join(outDir, "worker_public_key"))) {
  console.error(
    "Only one of worker_keys / worker_public_key exists. Restore the pair from backup.",
  );
  process.exit(1);
}

const password = () => randomBytes(32).toString("base64url");
const worker = await generateKeyPair();

const files: Record<string, () => string | Promise<string>> = {
  postgres_admin_password: password,
  app_db_password: password,
  auth_encryption_key: generateSecretKey,
  worker_keys: () => JSON.stringify([worker]),
  worker_public_key: () => worker.publicKey,
  restic_password: password,
};

for (const [name, make] of Object.entries(files)) {
  const path = join(outDir, name);
  try {
    // "wx" creates the file only if it doesn't exist, atomically: never overwrites a secret.
    writeFileSync(path, `${await make()}\n`, { mode: 0o644, flag: "wx" });
    console.log(`✓ wrote ${name}`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    console.log(`• ${name} exists, keeping it`);
  }
}
console.log(`\nSecrets are in ${outDir}. Back this folder up somewhere safe and offline:`);
console.log("losing worker_keys means re-linking every bank connection.");
