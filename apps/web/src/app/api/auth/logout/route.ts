import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/auth/request";
import { destroySession } from "@/lib/auth/session";

export async function POST(req: Request) {
  const bad = assertSameOrigin(req);
  if (bad) return bad;
  await destroySession();
  return NextResponse.json({ ok: true });
}
