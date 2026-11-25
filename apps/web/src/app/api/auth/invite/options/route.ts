import { randomToken } from "@mm/crypto";
import { schema } from "@mm/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { storeChallenge } from "@/lib/auth/challenge";
import { findValidInvite, inviteTokenHash } from "@/lib/auth/invites";
import { rateLimit } from "@/lib/auth/rate-limit";
import { assertSameOrigin, clientIp, jsonError } from "@/lib/auth/request";
import { registrationOptions } from "@/lib/auth/webauthn";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

const Body = z.object({
  token: z.string().min(20).max(100),
  displayName: z.string().trim().min(1).max(80),
});

export async function POST(req: Request) {
  const bad = assertSameOrigin(req);
  if (bad) return bad;
  if (env().demoMode) return jsonError("Not available in the demo.", 403);
  if (!rateLimit(`invite:${clientIp(req)}`, 10, 15 * 60_000))
    return jsonError("Too many attempts", 429);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return jsonError("Please enter your name.");
  const invite = await findValidInvite(db(), p.data.token);
  if (!invite)
    return jsonError("This invite link is invalid, used, or expired. Ask for a new one.", 404);
  const [taken] = await db()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, invite.email));
  if (taken) return jsonError("An account with this email already exists.", 409);

  const webauthnUserId = randomToken(32);
  const options = await registrationOptions({
    webauthnUserId,
    email: invite.email,
    displayName: p.data.displayName,
  });
  await storeChallenge("setup", options.challenge, {
    payload: {
      invite: true,
      tokenHash: inviteTokenHash(p.data.token),
      displayName: p.data.displayName,
      webauthnUserId,
    },
  });
  return NextResponse.json(options);
}
