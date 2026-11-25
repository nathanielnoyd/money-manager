import { schema } from "@mm/db";
import {
  type AuthenticationResponseJSON,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/auth/audit";
import { consumeChallenge } from "@/lib/auth/challenge";
import { assertSameOrigin, jsonError } from "@/lib/auth/request";
import { createSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/** Enough shape to look the credential up safely; verifyAuthenticationResponse checks the rest. */
const Body = z.looseObject({
  id: z.string().min(1).max(1024),
  response: z.looseObject({}),
});

export async function POST(req: Request) {
  const bad = assertSameOrigin(req);
  if (bad) return bad;
  const challenge = await consumeChallenge("login");
  if (!challenge) return jsonError("Sign-in timed out. Please try again.");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Malformed response.");
  const response = parsed.data as unknown as AuthenticationResponseJSON;

  const [pk] = await db()
    .select()
    .from(schema.passkeys)
    .where(eq(schema.passkeys.credentialId, response.id));
  if (!pk) {
    await audit({ action: "login.unknown_credential", req });
    return jsonError("This passkey isn't registered here.", 401);
  }

  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: env().origin,
    expectedRPID: env().rpId,
    requireUserVerification: true,
    credential: {
      id: pk.credentialId,
      publicKey: new Uint8Array(pk.publicKey),
      counter: pk.counter,
      transports: pk.transports ?? undefined,
    },
  }).catch(() => null);
  if (!result?.verified) {
    await audit({ action: "login.failed", userId: pk.userId, req });
    return jsonError("Passkey verification failed.", 401);
  }

  await db()
    .update(schema.passkeys)
    .set({ counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(schema.passkeys.id, pk.id));

  const [membership] = await db()
    .select()
    .from(schema.householdMembers)
    .where(eq(schema.householdMembers.userId, pk.userId))
    .limit(1);
  if (!membership) return jsonError("Your account isn't part of a household.", 403);

  await createSession({ userId: pk.userId, householdId: membership.householdId }, req);
  await audit({
    action: "login.passkey",
    userId: pk.userId,
    householdId: membership.householdId,
    req,
  });
  return NextResponse.json({ ok: true });
}
