import "server-only";
import { randomToken } from "@mm/crypto";
import { schema } from "@mm/db";
import { and, eq, gt, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "../db";
import { env } from "../env";

const COOKIE = "mm_challenge";
const TTL_MS = 5 * 60 * 1000;

export type ChallengePurpose = "setup" | "login" | "add-passkey";

/** Persist a WebAuthn challenge server-side; the browser only holds an opaque id. */
export async function storeChallenge(
  purpose: ChallengePurpose,
  challenge: string,
  extra: { userId?: string; payload?: Record<string, unknown> } = {},
): Promise<void> {
  const id = randomToken(24);
  await db().delete(schema.authChallenges).where(lt(schema.authChallenges.expiresAt, new Date()));
  await db()
    .insert(schema.authChallenges)
    .values({
      id,
      challenge,
      purpose,
      userId: extra.userId ?? null,
      payload: extra.payload ?? null,
      expiresAt: new Date(Date.now() + TTL_MS),
    });
  (await cookies()).set(COOKIE, id, {
    httpOnly: true,
    secure: env().secureCookies,
    sameSite: "strict",
    path: "/api/auth",
    maxAge: TTL_MS / 1000,
  });
}

/** Fetch and delete (single use) the challenge for this browser. */
export async function consumeChallenge(purpose: ChallengePurpose) {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  jar.delete({ name: COOKIE, path: "/api/auth" });
  if (!id) return null;
  const [row] = await db()
    .delete(schema.authChallenges)
    .where(
      and(
        eq(schema.authChallenges.id, id),
        eq(schema.authChallenges.purpose, purpose),
        gt(schema.authChallenges.expiresAt, new Date()),
      ),
    )
    .returning();
  return row ?? null;
}
