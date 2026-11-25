import { decryptSecret, hashRecoveryCode, verifyTotp } from "@mm/crypto";
import { schema } from "@mm/db";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/auth/audit";
import { rateLimit } from "@/lib/auth/rate-limit";
import { assertSameOrigin, clientIp, jsonError } from "@/lib/auth/request";
import { createSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

const Body = z.object({
  email: z.email().max(254),
  code: z.string().min(8).max(40),
  totp: z.string().max(6).optional(),
});

const GENERIC = "That combination didn't work.";

/** Break-glass sign-in with a single-use recovery code (+ TOTP when enrolled). */
export async function POST(req: Request) {
  const bad = assertSameOrigin(req);
  if (bad) return bad;
  if (env().demoMode) return jsonError("Not available in the demo.", 403);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(GENERIC, 401);
  const email = parsed.data.email.toLowerCase();
  if (
    !rateLimit(`recovery-ip:${clientIp(req)}`, 5, 15 * 60_000) ||
    !rateLimit(`recovery-user:${email}`, 5, 60 * 60_000)
  ) {
    return jsonError("Too many attempts. Try again later.", 429);
  }

  const [user] = await db().select().from(schema.users).where(eq(schema.users.email, email));
  if (!user) return jsonError(GENERIC, 401);

  const [totp] = await db()
    .select()
    .from(schema.totpSecrets)
    .where(eq(schema.totpSecrets.userId, user.id));
  if (totp?.confirmedAt) {
    const secret = await decryptSecret(totp.secretSealed, env().authEncryptionKey);
    const step = verifyTotp(secret, parsed.data.totp ?? "", { lastUsedStep: totp.lastUsedStep });
    if (step === null) {
      await audit({ action: "recovery.failed_totp", userId: user.id, req });
      return jsonError(GENERIC, 401);
    }
    // Conditional update: if a concurrent request already used this (or a later) code, we lose.
    const [claimed] = await db()
      .update(schema.totpSecrets)
      .set({ lastUsedStep: step })
      .where(
        and(
          eq(schema.totpSecrets.userId, user.id),
          or(isNull(schema.totpSecrets.lastUsedStep), lt(schema.totpSecrets.lastUsedStep, step)),
        ),
      )
      .returning({ userId: schema.totpSecrets.userId });
    if (!claimed) {
      await audit({ action: "recovery.failed_totp", userId: user.id, req });
      return jsonError(GENERIC, 401);
    }
  }

  const [used] = await db()
    .update(schema.recoveryCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(schema.recoveryCodes.userId, user.id),
        eq(schema.recoveryCodes.codeHash, hashRecoveryCode(parsed.data.code)),
        isNull(schema.recoveryCodes.usedAt),
      ),
    )
    .returning();
  if (!used) {
    await audit({ action: "recovery.failed_code", userId: user.id, req });
    return jsonError(GENERIC, 401);
  }

  const [membership] = await db()
    .select()
    .from(schema.householdMembers)
    .where(eq(schema.householdMembers.userId, user.id))
    .limit(1);
  if (!membership) return jsonError(GENERIC, 401);

  await createSession({ userId: user.id, householdId: membership.householdId }, req, "recovery");
  await audit({
    action: "login.recovery_code",
    userId: user.id,
    householdId: membership.householdId,
    req,
  });
  return NextResponse.json({ ok: true });
}
