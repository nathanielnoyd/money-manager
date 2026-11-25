import { schema } from "@mm/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { audit } from "@/lib/auth/audit";
import { guard } from "@/lib/auth/guard";
import { db } from "@/lib/db";

export async function DELETE(req: Request) {
  const { session, error } = await guard(req, { stepUp: true });
  if (error) return error;
  await db().delete(schema.totpSecrets).where(eq(schema.totpSecrets.userId, session.userId));
  await audit({
    action: "totp.disabled",
    userId: session.userId,
    householdId: session.householdId,
    req,
  });
  return NextResponse.json({ ok: true });
}
