"use server";

import { AiBudgetError, categorizeUncategorized } from "@mm/ai";
import { schema, withHousehold } from "@mm/db";
import {
  addTransaction as addTransactionOp,
  deleteTransaction as deleteTransactionOp,
  updateTransaction as updateTransactionOp,
  updateTransactions,
} from "@mm/services";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AI_BUDGET_MESSAGE, aiRateLimit, householdAiSettings, serverAi } from "@/lib/ai";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { type ActionResult, denyUnless, inHousehold, runOperation } from "@/lib/household";
import { ownsAll } from "@/lib/owned";

const Id = z.uuid();

/** Fields as the transaction editor sends them; see `update_transaction` in @mm/services. */
type Update = Omit<z.input<typeof updateTransactionOp.input>, "id">;

function refresh() {
  revalidatePath("/transactions");
  revalidatePath("/");
}

export async function updateTransaction(
  id: string,
  input: Update,
): Promise<ActionResult<{ applied?: number }>> {
  const r = await runOperation(
    updateTransactionOp,
    { ...input, id },
    {
      invalidMessage: "Invalid change.",
    },
  );
  if (r.ok) refresh();
  return r;
}

/** Add a transaction by hand to an account that isn't synced. `amount` is signed cents. */
export async function addTransaction(input: {
  accountId: string;
  date: string;
  amount: number;
  description: string;
  categoryId: string | null;
  notes?: string;
  adjustBalance: boolean;
}): Promise<ActionResult<{ id: string }>> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  if (!input || !Number.isSafeInteger(input.amount) || input.amount === 0)
    return { ok: false, error: "Enter an amount." };
  const r = await runOperation(
    addTransactionOp,
    { ...input, amount: input.amount / 100 },
    { invalidMessage: "Check the date, amount and description." },
  );
  if (r.ok) refresh();
  return r;
}

export async function deleteTransaction(id: string, adjustBalance: boolean): Promise<ActionResult> {
  const r = await runOperation(
    deleteTransactionOp,
    { id, adjustBalance },
    { invalidMessage: "Invalid transaction." },
  );
  if (!r.ok) return r;
  refresh();
  return { ok: true };
}

export async function bulkUpdate(
  input: z.input<typeof updateTransactions.input>,
): Promise<ActionResult<{ count: number }>> {
  const r = await runOperation(updateTransactions, input, { invalidMessage: "Invalid change." });
  if (r.ok) refresh();
  return r;
}

const Split = z.object({
  parts: z
    .array(
      z.object({
        amount: z
          .number()
          .int()
          .refine((n) => n !== 0),
        categoryId: z.uuid().nullable(),
        notes: z.string().max(500).optional(),
      }),
    )
    .min(2)
    .max(20),
});

/** Divide a transaction across categories. Children carry the amounts; the parent stays for display. */
export async function splitTransaction(
  id: string,
  input: z.input<typeof Split>,
): Promise<ActionResult> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  const p = Split.safeParse(input);
  if (!Id.safeParse(id).success || !p.success)
    return { ok: false, error: "Each part needs a non-zero amount." };
  const err = await inHousehold(async (tx, s) => {
    const [parent] = await tx
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.id, id));
    if (!parent || parent.splitParentId) return "Transaction not found.";
    if (
      !(await ownsAll(
        tx,
        "categories",
        p.data.parts.map((x) => x.categoryId),
      ))
    )
      return "That category doesn't exist.";
    const sum = p.data.parts.reduce((t, x) => t + x.amount, 0);
    if (sum !== parent.amount) return "The parts must add up to the transaction amount.";
    await tx.delete(schema.transactions).where(eq(schema.transactions.splitParentId, id));
    await tx.insert(schema.transactions).values(
      p.data.parts.map((x) => ({
        householdId: s.householdId,
        accountId: parent.accountId,
        date: parent.date,
        amount: x.amount,
        currency: parent.currency,
        pending: parent.pending,
        rawDescription: parent.rawDescription,
        merchantId: parent.merchantId,
        categoryId: x.categoryId,
        categorySource: x.categoryId ? "user" : null,
        notes: x.notes?.trim() || null,
        reviewed: true,
        excluded: parent.excluded,
        splitParentId: id,
      })),
    );
    await tx
      .update(schema.transactions)
      .set({ isSplit: true, categoryId: null, reviewed: true })
      .where(eq(schema.transactions.id, id));
    return null;
  });
  if (err) return { ok: false, error: err };
  refresh();
  return { ok: true };
}

export async function unsplitTransaction(id: string): Promise<ActionResult> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  if (!Id.safeParse(id).success) return { ok: false, error: "Invalid transaction." };
  await inHousehold(async (tx) => {
    const parts = await tx
      .delete(schema.transactions)
      .where(eq(schema.transactions.splitParentId, id))
      .returning({
        amount: schema.transactions.amount,
        categoryId: schema.transactions.categoryId,
      });
    // Splitting cleared the transaction's own category. Give it back the category of the
    // largest part, which is nearly always what it had before.
    const largest = parts
      .filter((x) => x.categoryId)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
    await tx
      .update(schema.transactions)
      .set({
        isSplit: false,
        ...(largest ? { categoryId: largest.categoryId, categorySource: "user" } : {}),
      })
      .where(and(eq(schema.transactions.id, id), eq(schema.transactions.isSplit, true)));
  });
  refresh();
  return { ok: true };
}

/** Ask Claude to suggest categories for up to 200 uncategorized transactions. */
export async function categorizeWithAi(): Promise<
  ActionResult<{ considered: number; applied: number }>
> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  const s = await requireSession();
  const ai = serverAi();
  if (!ai) return { ok: false, error: "AI isn't configured on this server." };
  const settings = await withHousehold(db(), s.householdId, (tx) =>
    householdAiSettings(tx, s.householdId),
  );
  if (!settings.enabled)
    return { ok: false, error: "AI features are turned off for this household." };
  if (!aiRateLimit(s.householdId))
    return { ok: false, error: "Too many AI requests this hour. Try again later." };
  try {
    const r = await categorizeUncategorized(db(), s.householdId, ai, { limit: 200 });
    refresh();
    return { ok: true, data: r };
  } catch (e) {
    if (e instanceof AiBudgetError) return { ok: false, error: AI_BUDGET_MESSAGE };
    console.error("categorize failed", (e as Error).message);
    return { ok: false, error: "The AI service didn't respond. Try again in a moment." };
  }
}
