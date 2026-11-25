import { demoVisitor } from "@mm/db";
import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/auth/rate-limit";
import { assertSameOrigin, clientIp, jsonError } from "@/lib/auth/request";
import { createSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/** DEMO_MODE only: start a read-only session in the demo household. */
export async function POST(req: Request) {
  const bad = assertSameOrigin(req);
  if (bad) return bad;
  if (!env().demoMode) return jsonError("Not found", 404);
  if (!rateLimit(`demo:${clientIp(req)}`, 20, 60 * 60_000))
    return jsonError("Too many demo sessions from your network. Try again later.", 429);
  const visitor = await demoVisitor(db());
  if (!visitor) return jsonError("The demo is being reset. Try again in a minute.", 503);
  await createSession(visitor, req, "demo");
  return NextResponse.json({ ok: true });
}
