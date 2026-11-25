import "server-only";
import { generateRecoveryCodes, hashRecoveryCode } from "@mm/crypto";
import { type Executor, schema } from "@mm/db";
import { eq } from "drizzle-orm";

/** Replace a user's recovery codes; returns the plaintext codes to show exactly once. */
export async function issueRecoveryCodes(tx: Executor, userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes(10);
  await tx.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, userId));
  await tx
    .insert(schema.recoveryCodes)
    .values(codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) })));
  return codes;
}
