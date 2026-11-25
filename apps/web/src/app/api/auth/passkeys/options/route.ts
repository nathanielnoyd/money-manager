import { schema } from "@mm/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { storeChallenge } from "@/lib/auth/challenge";
import { guard } from "@/lib/auth/guard";
import { registrationOptions } from "@/lib/auth/webauthn";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  const { session, error } = await guard(req, { stepUp: true, allowFreshRecovery: true });
  if (error) return error;
  const [user] = await db().select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const existing = await db()
    .select({ id: schema.passkeys.credentialId })
    .from(schema.passkeys)
    .where(eq(schema.passkeys.userId, user.id));
  const options = await registrationOptions({
    webauthnUserId: user.webauthnUserId,
    email: user.email,
    displayName: user.displayName,
    existingCredentialIds: existing.map((e) => e.id),
  });
  await storeChallenge("add-passkey", options.challenge, { userId: user.id });
  return NextResponse.json(options);
}
