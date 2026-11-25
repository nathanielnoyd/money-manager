import "server-only";
import { randomToken, sha256Hex } from "@mm/crypto";
import { schema, withHousehold } from "@mm/db";
import { and, eq, gt, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "../db";
import { env } from "../env";
import { clientIp } from "./request";

const ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const IDLE_TTL_MS = 12 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
/** Sensitive actions need a passkey authentication this recent. */
export const STEP_UP_MS = 15 * 60 * 1000;

export const sessionCookieName = () => (env().secureCookies ? "__Host-mm_session" : "mm_session");

export interface Session {
  tokenHash: string;
  userId: string;
  householdId: string;
  email: string;
  displayName: string;
  householdName: string;
  role: "owner" | "member" | "viewer";
  authenticatedAt: Date;
  authMethod: AuthMethod;
  createdAt: Date;
}

export type AuthMethod = "passkey" | "recovery" | "demo";

export async function createSession(
  input: { userId: string; householdId: string },
  req: Request,
  method: AuthMethod = "passkey",
): Promise<void> {
  const token = randomToken();
  await db()
    .insert(schema.sessions)
    .values({
      tokenHash: sha256Hex(token),
      userId: input.userId,
      householdId: input.householdId,
      expiresAt: new Date(Date.now() + ABSOLUTE_TTL_MS),
      userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
      ip: clientIp(req),
      authMethod: method,
      // Only a passkey sign-in counts as a strong, recent authentication for step-up checks.
      authenticatedAt: method === "passkey" ? new Date() : new Date(0),
    });
  const jar = await cookies();
  // Rotate: drop any session the browser already had.
  const previous = jar.get(sessionCookieName())?.value;
  if (previous) {
    await db()
      .delete(schema.sessions)
      .where(eq(schema.sessions.tokenHash, sha256Hex(previous)));
  }
  jar.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: env().secureCookies,
    sameSite: "strict",
    path: "/",
    maxAge: ABSOLUTE_TTL_MS / 1000,
  });
}

/** Current session or null. Memoised per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const now = new Date();
  const [row] = await db()
    .select({
      tokenHash: schema.sessions.tokenHash,
      userId: schema.sessions.userId,
      householdId: schema.sessions.householdId,
      lastSeenAt: schema.sessions.lastSeenAt,
      authenticatedAt: schema.sessions.authenticatedAt,
      authMethod: schema.sessions.authMethod,
      createdAt: schema.sessions.createdAt,
      email: schema.users.email,
      displayName: schema.users.displayName,
      role: schema.householdMembers.role,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    // A removed member's sessions stop working immediately: no membership, no session.
    .innerJoin(
      schema.householdMembers,
      and(
        eq(schema.householdMembers.userId, schema.sessions.userId),
        eq(schema.householdMembers.householdId, schema.sessions.householdId),
      ),
    )
    .where(and(eq(schema.sessions.tokenHash, tokenHash), gt(schema.sessions.expiresAt, now)));
  if (!row) return null;
  if (now.getTime() - row.lastSeenAt.getTime() > IDLE_TTL_MS) {
    await db().delete(schema.sessions).where(eq(schema.sessions.tokenHash, tokenHash));
    return null;
  }
  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db()
      .update(schema.sessions)
      .set({ lastSeenAt: now })
      .where(eq(schema.sessions.tokenHash, tokenHash));
  }
  const [household] = await withHousehold(db(), row.householdId, (tx) =>
    tx
      .select({ name: schema.households.name })
      .from(schema.households)
      .where(eq(schema.households.id, row.householdId)),
  );
  return {
    tokenHash: row.tokenHash,
    userId: row.userId,
    householdId: row.householdId,
    email: row.email,
    displayName: row.displayName,
    householdName: household?.name ?? "Household",
    role: row.role,
    authenticatedAt: row.authenticatedAt,
    authMethod: row.authMethod as AuthMethod,
    createdAt: row.createdAt,
  };
});

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export const isRecentlyAuthenticated = (s: Session) =>
  s.authMethod === "passkey" && Date.now() - s.authenticatedAt.getTime() < STEP_UP_MS;

/** A just-recovered session may do exactly one privileged thing: register a new passkey. */
export const isFreshRecovery = (s: Session) =>
  s.authMethod === "recovery" && Date.now() - s.createdAt.getTime() < STEP_UP_MS;

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (token) {
    await db()
      .delete(schema.sessions)
      .where(eq(schema.sessions.tokenHash, sha256Hex(token)));
  }
  jar.delete(sessionCookieName());
}

export async function revokeOtherSessions(s: Session): Promise<void> {
  await db()
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.userId, s.userId), ne(schema.sessions.tokenHash, s.tokenHash)));
}
