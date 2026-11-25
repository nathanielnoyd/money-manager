import { NextResponse } from "next/server";
import { storeChallenge } from "@/lib/auth/challenge";
import { rateLimit } from "@/lib/auth/rate-limit";
import { assertSameOrigin, clientIp, jsonError } from "@/lib/auth/request";
import { authenticationOptions } from "@/lib/auth/webauthn";

export async function POST(req: Request) {
  const bad = assertSameOrigin(req);
  if (bad) return bad;
  if (!rateLimit(`login:${clientIp(req)}`, 30, 15 * 60_000))
    return jsonError("Too many attempts", 429);
  const options = await authenticationOptions();
  await storeChallenge("login", options.challenge);
  return NextResponse.json(options);
}
