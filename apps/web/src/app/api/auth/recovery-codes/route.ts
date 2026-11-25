import { NextResponse } from "next/server";
import { audit } from "@/lib/auth/audit";
import { guard } from "@/lib/auth/guard";
import { issueRecoveryCodes } from "@/lib/auth/recovery";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  const { session, error } = await guard(req, { stepUp: true });
  if (error) return error;
  const codes = await issueRecoveryCodes(db(), session.userId);
  await audit({
    action: "recovery_codes.regenerated",
    userId: session.userId,
    householdId: session.householdId,
    req,
  });
  return NextResponse.json({ recoveryCodes: codes });
}
