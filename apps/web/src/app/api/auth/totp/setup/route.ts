import { encryptSecret, generateTotpSecret, totpUri } from "@mm/crypto";
import { schema } from "@mm/db";
import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { guard } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/** Start TOTP enrolment: store an unconfirmed secret and return a QR code to scan. */
export async function POST(req: Request) {
  const { session, error } = await guard(req, { stepUp: true });
  if (error) return error;
  const secret = generateTotpSecret();
  const secretSealed = await encryptSecret(secret, env().authEncryptionKey);
  await db()
    .insert(schema.totpSecrets)
    .values({ userId: session.userId, secretSealed })
    .onConflictDoUpdate({
      target: schema.totpSecrets.userId,
      set: { secretSealed, confirmedAt: null, lastUsedStep: null },
    });
  const uri = totpUri(secret, session.email, env().rpName);
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  return NextResponse.json({ secret, qr });
}
