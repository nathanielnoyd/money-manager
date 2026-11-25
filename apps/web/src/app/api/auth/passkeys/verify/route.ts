import { schema } from "@mm/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/auth/audit";
import { consumeChallenge } from "@/lib/auth/challenge";
import { guard } from "@/lib/auth/guard";
import { jsonError } from "@/lib/auth/request";
import { verifyRegistration } from "@/lib/auth/webauthn";
import { db } from "@/lib/db";

/** The WebAuthn response itself is checked field by field by verifyRegistration. */
const Body = z.object({
  response: z.looseObject({ id: z.string().max(1024) }),
  nickname: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  const { session, error } = await guard(req, { stepUp: true, allowFreshRecovery: true });
  if (error) return error;
  const challenge = await consumeChallenge("add-passkey");
  if (!challenge || challenge.userId !== session.userId) return jsonError("Timed out. Try again.");
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError("Passkey verification failed.");
  const reg = await verifyRegistration(body.data.response as never, challenge.challenge).catch(
    () => null,
  );
  if (!reg) return jsonError("Passkey verification failed.");
  const nickname = (body.data.nickname ?? "").trim().slice(0, 60) || "Passkey";
  await db()
    .insert(schema.passkeys)
    .values({ ...reg, userId: session.userId, nickname });
  await audit({
    action: "passkey.added",
    userId: session.userId,
    householdId: session.householdId,
    req,
  });
  return NextResponse.json({ ok: true });
}
