"use server";

import { ACCOUNT_TYPES } from "@mm/core";
import { recordBalance, schema, withHousehold } from "@mm/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import { type ActionResult, denyUnless, inHousehold, requireStepUp } from "@/lib/household";

const refresh = () => {
  revalidatePath("/accounts");
  revalidatePath("/");
  revalidatePath("/transactions");
};

const Edit = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(ACCOUNT_TYPES),
  includeInNetWorth: z.boolean(),
  hidden: z.boolean(),
});

export async function updateAccount(
  id: string,
  input: z.input<typeof Edit>,
): Promise<ActionResult> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  const p = Edit.safeParse(input);
  if (!z.uuid().safeParse(id).success || !p.success)
    return { ok: false, error: "Check the account details." };
  await inHousehold((tx) =>
    tx.update(schema.accounts).set(p.data).where(eq(schema.accounts.id, id)),
  );
  refresh();
  return { ok: true };
}

const Manual = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(ACCOUNT_TYPES),
  /** Stored convention: liabilities positive = amount owed. */
  balance: z.number().int().refine(Number.isSafeInteger),
});

/** Accounts without a bank connection: a house, a car, cash, a private loan… */
export async function createManualAccount(input: z.input<typeof Manual>): Promise<ActionResult> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  const p = Manual.safeParse(input);
  if (!p.success) return { ok: false, error: "Check the account details." };
  await inHousehold(async (tx, s) => {
    const [a] = await tx
      .insert(schema.accounts)
      .values({
        householdId: s.householdId,
        name: p.data.name,
        type: p.data.type,
        currentBalance: p.data.balance,
        balanceUpdatedAt: new Date(),
        sortOrder: 1000,
      })
      .returning({ id: schema.accounts.id });
    await recordBalance(tx, s.householdId, a?.id as string, p.data.balance);
  });
  refresh();
  return { ok: true };
}

export async function updateManualBalance(id: string, balance: number): Promise<ActionResult> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  if (!z.uuid().safeParse(id).success || !Number.isSafeInteger(balance))
    return { ok: false, error: "Invalid balance." };
  const err = await inHousehold(async (tx, s) => {
    const [a] = await tx.select().from(schema.accounts).where(eq(schema.accounts.id, id));
    if (!a) return "Account not found.";
    if (a.connectionId) return "This account's balance comes from your bank.";
    await tx
      .update(schema.accounts)
      .set({ currentBalance: balance, balanceUpdatedAt: new Date() })
      .where(eq(schema.accounts.id, id));
    await recordBalance(tx, s.householdId, id, balance);
    return null;
  });
  if (err) return { ok: false, error: err };
  refresh();
  return { ok: true };
}

/** Permanently deletes the account and all its transactions. Requires a recent passkey check. */
export async function deleteAccount(id: string): Promise<ActionResult> {
  const s = await requireStepUp();
  if ("ok" in s) return s;
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Invalid account." };
  const deleted = await withHousehold(db(), s.householdId, (tx) =>
    tx
      .delete(schema.accounts)
      .where(eq(schema.accounts.id, id))
      .returning({ name: schema.accounts.name }),
  );
  await audit({
    action: "account.deleted",
    userId: s.userId,
    householdId: s.householdId,
    detail: { id, name: deleted[0]?.name },
  });
  refresh();
  return { ok: true };
}
