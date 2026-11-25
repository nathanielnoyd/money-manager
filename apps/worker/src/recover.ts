import { generateRecoveryCodes, hashRecoveryCode } from "@mm/crypto";
import { type Db, schema } from "@mm/db";
import { eq, sql } from "drizzle-orm";

/**
 * Break-glass for someone who lost both their passkey and their recovery codes: issue a fresh
 * set of recovery codes from the server's command line. Whoever can run this already has the
 * database admin password, so it grants nothing they couldn't take.
 *
 * A recovery sign-in can do one thing, register a new passkey, so this does not by itself
 * open the account. Old recovery codes stop working. Existing passkeys and sessions are kept.
 */
export class RecoverError extends Error {}

export interface RecoverResult {
  email: string;
  codes: string[];
  /** True if an authenticator app was enrolled and has been removed (--remove-totp). */
  totpRemoved: boolean;
  /** True if an authenticator app is still enrolled: its code is needed to use a recovery code. */
  totpRequired: boolean;
}

export async function recoverAccess(
  db: Db,
  opts: { email?: string; removeTotp?: boolean } = {},
): Promise<RecoverResult> {
  const owners = await db
    .selectDistinct({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .innerJoin(schema.householdMembers, eq(schema.householdMembers.userId, schema.users.id))
    .where(eq(schema.householdMembers.role, "owner"));
  let user: { id: string; email: string } | undefined;
  if (opts.email) {
    const wanted = opts.email.trim().toLowerCase();
    [user] = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${wanted}`);
    if (!user) throw new RecoverError(`No account has the email ${wanted}.`);
  } else if (owners.length === 1) {
    user = owners[0];
  } else if (owners.length === 0) {
    throw new RecoverError("There are no accounts yet. Run the migrate step for a setup token.");
  } else {
    throw new RecoverError(
      `There are ${owners.length} owners. Say which one: ${owners.map((o) => o.email).join(", ")}`,
    );
  }
  if (!user) throw new RecoverError("No account found.");
  const target = user;

  const codes = generateRecoveryCodes(10);
  return db.transaction(async (tx) => {
    await tx.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, target.id));
    await tx
      .insert(schema.recoveryCodes)
      .values(codes.map((c) => ({ userId: target.id, codeHash: hashRecoveryCode(c) })));
    const [totp] = await tx
      .select({ confirmedAt: schema.totpSecrets.confirmedAt })
      .from(schema.totpSecrets)
      .where(eq(schema.totpSecrets.userId, target.id));
    const enrolled = !!totp?.confirmedAt;
    if (opts.removeTotp)
      await tx.delete(schema.totpSecrets).where(eq(schema.totpSecrets.userId, target.id));
    await tx.insert(schema.auditLog).values({
      userId: target.id,
      action: "recovery.codes_reissued_cli",
      detail: { totpRemoved: enrolled && !!opts.removeTotp },
    });
    return {
      email: target.email,
      codes,
      totpRemoved: enrolled && !!opts.removeTotp,
      totpRequired: enrolled && !opts.removeTotp,
    };
  });
}
