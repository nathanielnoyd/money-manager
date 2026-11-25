import { randomToken } from "@mm/crypto";
import { hasAnyUser, setupTokenHash, verifySetupToken } from "@mm/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/auth/audit";
import { storeChallenge } from "@/lib/auth/challenge";
import { rateLimit } from "@/lib/auth/rate-limit";
import { assertSameOrigin, clientIp, jsonError } from "@/lib/auth/request";
import { registrationOptions } from "@/lib/auth/webauthn";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

const Body = z.object({
  setupToken: z.string().min(10).max(200),
  email: z.email().max(254),
  displayName: z.string().trim().min(1).max(80),
  householdName: z.string().trim().min(1).max(80),
});

export async function POST(req: Request) {
  const bad = assertSameOrigin(req);
  if (bad) return bad;
  if (env().demoMode) return jsonError("Not available in the demo.", 403);
  if (!rateLimit(`setup:${clientIp(req)}`, 10, 15 * 60_000))
    return jsonError("Too many attempts", 429);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Please fill in every field.");
  const { setupToken, email, displayName, householdName } = parsed.data;

  if (await hasAnyUser(db())) return jsonError("This instance is already set up.", 409);
  if (!(await verifySetupToken(db(), setupToken))) {
    await audit({ action: "setup.token_rejected", req });
    return jsonError("That setup token is invalid or expired.", 403);
  }

  const webauthnUserId = randomToken(32);
  const options = await registrationOptions({ webauthnUserId, email, displayName });
  await storeChallenge("setup", options.challenge, {
    payload: {
      setupTokenHash: setupTokenHash(setupToken),
      email: email.toLowerCase(),
      displayName,
      householdName,
      webauthnUserId,
    },
  });
  return NextResponse.json(options);
}
