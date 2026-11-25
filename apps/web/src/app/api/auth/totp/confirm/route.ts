import { decryptSecret, verifyTotp } from "@mm/crypto";
import { schema } from "@mm/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/auth/audit";
import { guard } from "@/lib/auth/guard";
import { jsonError } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export async function POST(req: Request) {
  const { session, error } = await guard(req, { stepUp: true });
  if (error) return error;
  const body = z.object({ code: z.string().max(12) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError("Enter the 6-digit code from your authenticator app.");
  const { code } = body.data;
  const [row] = await db()
    .select()
    .from(schema.totpSecrets)
    .where(eq(schema.totpSecrets.userId, session.userId));
  if (!row) return jsonError("Start setup first.");
  const step = verifyTotp(await decryptSecret(row.secretSealed, env().authEncryptionKey), code);
  if (step === null) return jsonError("That code didn't match. Check your device's clock.");
  await db()
    .update(schema.totpSecrets)
    .set({ confirmedAt: new Date(), lastUsedStep: step })
    .where(eq(schema.totpSecrets.userId, session.userId));
  await audit({
    action: "totp.enabled",
    userId: session.userId,
    householdId: session.householdId,
    req,
  });
  return NextResponse.json({ ok: true });
}
