"use server";

import { ACCOUNT_TYPES, isLiability } from "@mm/core";
import { ingestTransactions, recordBalance, refreshRecurring, schema } from "@mm/db";
import { and, eq, inArray, notLike } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/auth/audit";
import { type ActionResult, denyUnless, inHousehold } from "@/lib/household";

const Row = z.object({
  providerTransactionId: z.string().regex(/^(file|ofx):[\w.:-]{1,190}$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().int().refine(Number.isSafeInteger),
  description: z.string().trim().min(1).max(500),
});

const Input = z.object({
  target: z.union([
    z.object({ accountId: z.uuid() }),
    z.object({
      newAccount: z.object({
        name: z.string().trim().min(1).max(80),
        type: z.enum(ACCOUNT_TYPES),
        mask: z.string().max(4).optional(),
      }),
    }),
  ]),
  transactions: z.array(Row).min(1).max(20_000),
  fileName: z.string().trim().max(200).optional(),
  /** Statement balance (asset perspective) and its date, from OFX files. */
  balance: z
    .object({ amount: z.number().int(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
    .optional(),
});

export async function importTransactions(
  input: z.input<typeof Input>,
): Promise<ActionResult<{ added: number; skipped: number; accountId: string }>> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The file contained rows we couldn't import." };
  const { target, transactions, balance, fileName } = parsed.data;

  const result = await inHousehold(async (tx, s) => {
    let account: typeof schema.accounts.$inferSelect | undefined;
    if ("accountId" in target) {
      [account] = await tx
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.id, target.accountId));
      if (!account) return null;
    } else {
      [account] = await tx
        .insert(schema.accounts)
        .values({
          householdId: s.householdId,
          name: target.newAccount.name,
          type: target.newAccount.type,
          mask: target.newAccount.mask || null,
        })
        .returning();
    }
    if (!account) return null;
    const accountId = account.id;

    // Avoid duplicating rows a connected bank already synced: skip same-day, same-amount matches.
    let rows = transactions;
    if (account.connectionId) {
      const dates = [...new Set(rows.map((r) => r.date))];
      const synced = await tx
        .select({ date: schema.transactions.date, amount: schema.transactions.amount })
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.accountId, accountId),
            inArray(schema.transactions.date, dates),
            notLike(schema.transactions.providerTransactionId, "file:%"),
            notLike(schema.transactions.providerTransactionId, "ofx:%"),
          ),
        );
      const seen = new Map<string, number>();
      for (const r of synced)
        seen.set(`${r.date}|${r.amount}`, (seen.get(`${r.date}|${r.amount}`) ?? 0) + 1);
      rows = rows.filter((r) => {
        const k = `${r.date}|${r.amount}`;
        const n = seen.get(k) ?? 0;
        if (n > 0) {
          seen.set(k, n - 1);
          return false;
        }
        return true;
      });
    }

    // Record the import so its rows can be removed together later (see undoImport).
    const [batch] = await tx
      .insert(schema.imports)
      .values({
        householdId: s.householdId,
        accountId,
        fileName: fileName || null,
        createdBy: s.userId,
      })
      .returning({ id: schema.imports.id });
    const importId = batch?.id as string;
    const r = await ingestTransactions(
      tx,
      s.householdId,
      rows.map((t) => ({ ...t, accountId, pending: false, importId })),
    );
    if (r.added > 0) {
      await tx
        .update(schema.imports)
        .set({ added: r.added })
        .where(eq(schema.imports.id, importId));
      await refreshRecurring(tx, s.householdId);
    } else {
      // Nothing new: every row was already there, so there is nothing to undo.
      await tx.delete(schema.imports).where(eq(schema.imports.id, importId));
    }

    if (balance && !account.connectionId) {
      const stored = isLiability(account.type) ? -balance.amount : balance.amount;
      await tx
        .update(schema.accounts)
        .set({ currentBalance: stored, balanceUpdatedAt: new Date(`${balance.date}T00:00:00Z`) })
        .where(eq(schema.accounts.id, accountId));
      await recordBalance(tx, s.householdId, accountId, stored, balance.date);
    }
    return { added: r.added, skipped: transactions.length - r.added, accountId, s };
  });
  if (!result) return { ok: false, error: "That account no longer exists." };
  await audit({
    action: "transactions.imported",
    userId: result.s.userId,
    householdId: result.s.householdId,
    detail: { added: result.added, skipped: result.skipped },
  });
  revalidatePath("/transactions");
  revalidatePath("/");
  return {
    ok: true,
    data: { added: result.added, skipped: result.skipped, accountId: result.accountId },
  };
}

/**
 * Remove every transaction an import added, for example after importing into the wrong
 * account. Rows that were already present before the import are not touched, and neither is
 * the account or its balance.
 */
export async function undoImport(importId: string): Promise<ActionResult<{ removed: number }>> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  if (!z.uuid().safeParse(importId).success) return { ok: false, error: "Import not found." };
  const result = await inHousehold(async (tx, s) => {
    const [batch] = await tx.select().from(schema.imports).where(eq(schema.imports.id, importId));
    if (!batch) return null;
    // Parts of a split go with their parent (foreign key, ON DELETE CASCADE).
    const gone = await tx
      .delete(schema.transactions)
      .where(eq(schema.transactions.importId, importId))
      .returning({ id: schema.transactions.id });
    await tx.delete(schema.imports).where(eq(schema.imports.id, importId));
    if (gone.length > 0) await refreshRecurring(tx, s.householdId);
    return { removed: gone.length, s };
  });
  if (!result) return { ok: false, error: "Import not found." };
  await audit({
    action: "transactions.import_undone",
    userId: result.s.userId,
    householdId: result.s.householdId,
    detail: { removed: result.removed },
  });
  revalidatePath("/transactions");
  revalidatePath("/transactions/import");
  revalidatePath("/");
  return { ok: true, data: { removed: result.removed } };
}
