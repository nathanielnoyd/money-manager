import { schema, withHousehold } from "@mm/db";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { audit } from "@/lib/auth/audit";
import { consumeChallenge } from "@/lib/auth/challenge";
import { findValidInviteByHash } from "@/lib/auth/invites";
import { issueRecoveryCodes } from "@/lib/auth/recovery";
import { assertSameOrigin, jsonError } from "@/lib/auth/request";
import { createSession } from "@/lib/auth/session";
import { verifyRegistration } from "@/lib/auth/webauthn";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

interface InvitePayload {
  invite: true;
  /** sha256 of the invite token: the raw token never sits in the challenge table. */
  tokenHash: string;
  displayName: string;
  webauthnUserId: string;
}

export async function POST(req: Request) {
  const bad = assertSameOrigin(req);
  if (bad) return bad;
  if (env().demoMode) return jsonError("Not available in the demo.", 403);
  const challenge = await consumeChallenge("setup");
  const p = challenge?.payload as InvitePayload | undefined;
  if (!challenge || !p?.invite) return jsonError("This took too long. Please try again.");

  const reg = await verifyRegistration(await req.json(), challenge.challenge).catch(() => null);
  if (!reg) return jsonError("Passkey verification failed.");

  const result = await db().transaction(async (tx) => {
    // Re-check inside the transaction and lock out concurrent acceptance of the same invite.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${p.tokenHash}))`);
    const invite = await findValidInviteByHash(tx, p.tokenHash);
    if (!invite) return null;
    const [taken] = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, invite.email));
    if (taken) return null;

    const [user] = await tx
      .insert(schema.users)
      .values({ email: invite.email, displayName: p.displayName, webauthnUserId: p.webauthnUserId })
      .returning();
    if (!user) throw new Error("user insert failed");
    await tx.insert(schema.passkeys).values({ ...reg, userId: user.id, nickname: "First passkey" });
    await tx
      .insert(schema.householdMembers)
      .values({ householdId: invite.household_id, userId: user.id, role: invite.role });
    await withHousehold(tx, invite.household_id, (h) =>
      h
        .update(schema.invites)
        .set({ acceptedAt: new Date() })
        .where(eq(schema.invites.id, invite.id)),
    );
    const recoveryCodes = await issueRecoveryCodes(tx, user.id);
    return { userId: user.id, householdId: invite.household_id, recoveryCodes };
  });
  if (!result) return jsonError("This invite is no longer valid.", 409);

  await createSession(result, req);
  await audit({
    action: "invite.accepted",
    userId: result.userId,
    householdId: result.householdId,
    req,
  });
  return NextResponse.json({ recoveryCodes: result.recoveryCodes });
}
