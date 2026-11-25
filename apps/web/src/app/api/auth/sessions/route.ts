import { NextResponse } from "next/server";
import { audit } from "@/lib/auth/audit";
import { guard } from "@/lib/auth/guard";
import { revokeOtherSessions } from "@/lib/auth/session";

/** Sign out every other device. */
export async function DELETE(req: Request) {
  const { session, error } = await guard(req);
  if (error) return error;
  await revokeOtherSessions(session);
  await audit({
    action: "sessions.revoked_others",
    userId: session.userId,
    householdId: session.householdId,
    req,
  });
  return NextResponse.json({ ok: true });
}
