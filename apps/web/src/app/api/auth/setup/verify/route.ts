import { consumeSetupToken, createHousehold, schema, verifySetupTokenHash } from "@mm/db";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { audit } from "@/lib/auth/audit";
import { consumeChallenge } from "@/lib/auth/challenge";
import { issueRecoveryCodes } from "@/lib/auth/recovery";
import { assertSameOrigin, jsonError } from "@/lib/auth/request";
import { createSession } from "@/lib/auth/session";
import { verifyRegistration } from "@/lib/auth/webauthn";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

interface SetupPayload {
  /** sha256 of the setup token: the raw token never sits in the challenge table. */
  setupTokenHash: string;
  email: string;
  displayName: string;
  householdName: string;
  webauthnUserId: string;
}

export async function POST(req: Request) {
  const bad = assertSameOrigin(req);
  if (bad) return bad;
  if (env().demoMode) return jsonError("Not available in the demo.", 403);
  const challenge = await consumeChallenge("setup");
  if (!challenge) return jsonError("Setup timed out. Please try again.", 400);
  const p = challenge.payload as SetupPayload;

  const reg = await verifyRegistration(await req.json(), challenge.challenge).catch(() => null);
  if (!reg) return jsonError("Passkey verification failed.", 400);

  const result = await db().transaction(async (tx) => {
    // Serialise first-run setup so two browsers can't both become owner.
    await tx.execute(sql`select pg_advisory_xact_lock(727001)`);
    const { rows } = await tx.execute<{ n: number }>(sql`select count(*)::int as n from users`);
    if ((rows[0]?.n ?? 0) > 0) return null;
    if (!(await verifySetupTokenHash(tx, p.setupTokenHash))) return null;

    const [user] = await tx
      .insert(schema.users)
      .values({ email: p.email, displayName: p.displayName, webauthnUserId: p.webauthnUserId })
      .returning();
    if (!user) throw new Error("user insert failed");
    await tx.insert(schema.passkeys).values({ ...reg, userId: user.id, nickname: "First passkey" });
    const householdId = await createHousehold(tx, { name: p.householdName, ownerUserId: user.id });
    const recoveryCodes = await issueRecoveryCodes(tx, user.id);
    await consumeSetupToken(tx);
    return { userId: user.id, householdId, recoveryCodes };
  });
  if (!result) return jsonError("This instance is already set up, or the token expired.", 409);

  await createSession(result, req);
  await audit({
    action: "setup.completed",
    userId: result.userId,
    householdId: result.householdId,
    req,
  });
  return NextResponse.json({ recoveryCodes: result.recoveryCodes });
}
