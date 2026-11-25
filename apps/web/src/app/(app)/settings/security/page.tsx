import { schema } from "@mm/db";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { SecuritySettings } from "./security-settings";

export const metadata = { title: "Security" };

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ recovered?: string }>;
}) {
  const s = await requireSession();
  const { recovered } = await searchParams;
  const [passkeys, totp, codes, sessions] = await Promise.all([
    db()
      .select({
        id: schema.passkeys.id,
        nickname: schema.passkeys.nickname,
        createdAt: schema.passkeys.createdAt,
        lastUsedAt: schema.passkeys.lastUsedAt,
        backedUp: schema.passkeys.backedUp,
      })
      .from(schema.passkeys)
      .where(eq(schema.passkeys.userId, s.userId))
      .orderBy(schema.passkeys.createdAt),
    db().select().from(schema.totpSecrets).where(eq(schema.totpSecrets.userId, s.userId)),
    db()
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.recoveryCodes)
      .where(and(eq(schema.recoveryCodes.userId, s.userId), isNull(schema.recoveryCodes.usedAt))),
    db()
      .select({
        tokenHash: schema.sessions.tokenHash,
        userAgent: schema.sessions.userAgent,
        lastSeenAt: schema.sessions.lastSeenAt,
        createdAt: schema.sessions.createdAt,
      })
      .from(schema.sessions)
      .where(and(eq(schema.sessions.userId, s.userId), gt(schema.sessions.expiresAt, new Date())))
      .orderBy(desc(schema.sessions.lastSeenAt)),
  ]);

  return (
    <>
      <PageHeader
        title="Security"
        description="How you sign in, and how you get back in if you lose a device."
      />
      <SecuritySettings
        recovered={recovered === "1"}
        passkeys={passkeys.map((p) => ({
          ...p,
          createdAt: p.createdAt.toISOString(),
          lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
        }))}
        totpEnabled={!!totp[0]?.confirmedAt}
        recoveryCodesRemaining={codes[0]?.n ?? 0}
        sessions={sessions.map((x) => ({
          current: x.tokenHash === s.tokenHash,
          userAgent: x.userAgent,
          lastSeenAt: x.lastSeenAt.toISOString(),
        }))}
      />
    </>
  );
}
