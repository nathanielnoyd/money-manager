import "server-only";
import { readSecret } from "@mm/db";

/** Server configuration, read once. Secrets prefer `${NAME}_FILE` (Docker secrets). */
function load() {
  const appUrl = new URL(process.env.APP_URL ?? "http://localhost:3000");
  const accessMode = (process.env.ACCESS_MODE ?? "none") as "tailscale" | "cloudflare" | "none";
  if (
    process.env.NODE_ENV === "production" &&
    accessMode === "none" &&
    !process.env.ALLOW_NO_ACCESS_GATE
  ) {
    throw new Error(
      "ACCESS_MODE must be 'tailscale' or 'cloudflare' in production (set ALLOW_NO_ACCESS_GATE=1 to override).",
    );
  }
  return {
    isProd: process.env.NODE_ENV === "production",
    /** Public read-only demo: see packages/db/src/demo.ts and docs/demo.md. */
    demoMode: process.env.DEMO_MODE === "1",
    /** Secure cookies whenever served over HTTPS (Tailscale serve / Cloudflare always are). */
    secureCookies: appUrl.protocol === "https:",
    appUrl,
    origin: appUrl.origin,
    rpId: appUrl.hostname,
    rpName: process.env.APP_NAME ?? "Money Manager",
    databaseUrl: readSecret("DATABASE_URL") ?? buildDatabaseUrl(),
    authEncryptionKey: readSecret("AUTH_ENCRYPTION_KEY", true),
    workerPublicKey: readSecret("WORKER_PUBLIC_KEY", true),
    accessMode,
    plaid: plaidConfig(),
    /** Teller Connect needs only the public application id in the browser. */
    teller: process.env.TELLER_APPLICATION_ID
      ? {
          applicationId: process.env.TELLER_APPLICATION_ID,
          env: (process.env.TELLER_ENV ?? "sandbox") as "sandbox" | "development" | "production",
        }
      : null,
  };
}

/** Plaid is optional and bring-your-own-keys. */
function plaidConfig() {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = readSecret("PLAID_SECRET");
  if (!clientId || !secret) return null;
  return {
    clientId,
    secret,
    env: (process.env.PLAID_ENV === "production" ? "production" : "sandbox") as
      | "production"
      | "sandbox",
    redirectUri: process.env.PLAID_REDIRECT_URI || undefined,
  };
}

function buildDatabaseUrl(): string {
  const password = readSecret("APP_DB_PASSWORD", true);
  const host = process.env.DATABASE_HOST ?? "db";
  const name = process.env.DATABASE_NAME ?? "money_manager";
  return `postgres://mm_app:${encodeURIComponent(password)}@${host}:5432/${name}`;
}

let cached: ReturnType<typeof load> | undefined;
export const env = () => {
  cached ??= load();
  return cached;
};
