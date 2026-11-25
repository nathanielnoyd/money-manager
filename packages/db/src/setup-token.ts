import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Executor as Db } from "./client";
import { appSettings, users } from "./schema";

const KEY = "setup_token";
const TTL_MS = 24 * 60 * 60 * 1000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function hasAnyUser(db: Db): Promise<boolean> {
  const { rows } = await db.execute<{ n: number }>(sql`select count(*)::int as n from ${users}`);
  return (rows[0]?.n ?? 0) > 0;
}

/** Create (or replace) the one-time first-run setup token. Returns the raw token. */
export async function issueSetupToken(db: Db): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  const value = { hash: sha256(token), expiresAt: new Date(Date.now() + TTL_MS).toISOString() };
  await db
    .insert(appSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } });
  return token;
}

/** Hash of a setup token, safe to keep in short-lived server state instead of the token. */
export const setupTokenHash = (presented: string): string => sha256(presented);

/** Constant-time check of a presented setup token. Does not consume it. */
export async function verifySetupToken(db: Db, presented: string): Promise<boolean> {
  return verifySetupTokenHash(db, sha256(presented));
}

/** Like verifySetupToken, for a hash from setupTokenHash. */
export async function verifySetupTokenHash(db: Db, hash: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(hash)) return false;
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
  const v = row?.value as { hash?: string; expiresAt?: string } | undefined;
  if (!v?.hash || !v.expiresAt || new Date(v.expiresAt).getTime() < Date.now()) return false;
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(v.hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function consumeSetupToken(db: Db): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.key, KEY));
}
