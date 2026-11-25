import { randomUUID } from "node:crypto";
import { isLiability } from "@mm/core";
import {
  applyRulesToExisting,
  ingestTransactions,
  recordBalance,
  refreshRecurring,
  schema,
  type Tx,
} from "@mm/db";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { defineOperation, OperationError } from "../operation";
import { cents, DateStr, ownsAll } from "../util";

const write = { minRole: "member", scope: "transactions:write", readOnly: false } as const;

async function merchantIdFor(tx: Tx, householdId: string, name: string): Promise<string> {
  await tx.insert(schema.merchants).values({ householdId, name }).onConflictDoNothing();
  const [m] = await tx
    .select({ id: schema.merchants.id })
    .from(schema.merchants)
    .where(eq(schema.merchants.name, name));
  return m?.id as string;
}

export const updateTransaction = defineOperation({
  ...write,
  name: "update_transaction",
  title: "Update transaction",
  description:
    "Change one transaction: merchant name, category (id from list_categories, or null to clear), notes, excluded or reviewed. With `rememberForMerchant` and a category, also creates a rule 'merchant = X → category' and applies it to past transactions.",
  idempotent: true,
  input: z.object({
    id: z.uuid(),
    merchantName: z.string().trim().min(1).max(120).optional(),
    categoryId: z.uuid().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    excluded: z.boolean().optional(),
    reviewed: z.boolean().optional(),
    rememberForMerchant: z.boolean().optional(),
  }),
  async run(tx, p, u) {
    const [txn] = await tx
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.id, u.id));
    if (!txn) throw new OperationError("not_found", "Transaction not found.");
    if (u.categoryId && !(await ownsAll(tx, "categories", [u.categoryId])))
      throw new OperationError("not_found", "That category doesn't exist.");
    const set: Partial<typeof schema.transactions.$inferInsert> = {};
    if (u.merchantName !== undefined)
      set.merchantId = await merchantIdFor(tx, p.householdId, u.merchantName);
    if (u.categoryId !== undefined) {
      set.categoryId = u.categoryId;
      set.categorySource = u.categoryId ? "user" : null;
    }
    if (u.notes !== undefined) set.notes = u.notes?.trim() || null;
    if (u.excluded !== undefined) set.excluded = u.excluded;
    if (u.reviewed !== undefined) set.reviewed = u.reviewed;
    if (Object.keys(set).length)
      await tx.update(schema.transactions).set(set).where(eq(schema.transactions.id, u.id));

    if (u.rememberForMerchant && u.categoryId) {
      const merchantId = set.merchantId ?? txn.merchantId;
      const [m] = merchantId
        ? await tx.select().from(schema.merchants).where(eq(schema.merchants.id, merchantId))
        : [];
      if (!m) return { applied: 0 };
      await tx
        .update(schema.merchants)
        .set({ defaultCategoryId: u.categoryId })
        .where(eq(schema.merchants.id, m.id));
      const [rule] = await tx
        .insert(schema.rules)
        .values({
          householdId: p.householdId,
          name: `${m.name} → category`,
          conditions: [{ field: "merchant", op: "equals", value: m.name }],
          actions: { setCategoryId: u.categoryId },
          priority: 100,
        })
        .returning({ id: schema.rules.id });
      return { applied: await applyRulesToExisting(tx, { ruleId: rule?.id }), ruleId: rule?.id };
    }
    return {};
  },
});

export const updateTransactions = defineOperation({
  ...write,
  name: "update_transactions",
  title: "Update many transactions",
  description:
    "Set the category (or null to clear), reviewed or excluded flag on up to 500 transactions at once. Split parents are skipped (edit their parts instead). Returns how many changed.",
  idempotent: true,
  input: z.object({
    ids: z.array(z.uuid()).min(1).max(500),
    categoryId: z.uuid().nullable().optional(),
    reviewed: z.boolean().optional(),
    excluded: z.boolean().optional(),
  }),
  async run(tx, _p, { ids, ...rest }) {
    const set: Record<string, unknown> = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== undefined),
    );
    if (rest.categoryId !== undefined) set.categorySource = rest.categoryId ? "user" : null;
    if (Object.keys(set).length === 0) return { count: 0 };
    if (rest.categoryId && !(await ownsAll(tx, "categories", [rest.categoryId])))
      throw new OperationError("not_found", "That category doesn't exist.");
    const r = await tx
      .update(schema.transactions)
      .set(set)
      .where(and(inArray(schema.transactions.id, ids), eq(schema.transactions.isSplit, false)))
      .returning({ id: schema.transactions.id });
    return { count: r.length };
  },
});

/** Where a transaction came from, judged by the id the ingest path gave it. */
export function transactionOrigin(
  providerTransactionId: string | null,
): "manual" | "file" | "bank" {
  if (providerTransactionId?.startsWith("manual:")) return "manual";
  if (providerTransactionId?.startsWith("file:") || providerTransactionId?.startsWith("ofx:"))
    return "file";
  return "bank";
}

/** Move a hand-kept account's balance by a transaction amount, and record today's snapshot. */
async function shiftBalance(
  tx: Tx,
  householdId: string,
  account: typeof schema.accounts.$inferSelect,
  amount: number,
): Promise<void> {
  // Liabilities are stored as a positive amount owed, so money out raises the balance.
  const balance = account.currentBalance + (isLiability(account.type) ? -amount : amount);
  await tx
    .update(schema.accounts)
    .set({ currentBalance: balance, balanceUpdatedAt: new Date() })
    .where(eq(schema.accounts.id, account.id));
  await recordBalance(tx, householdId, account.id, balance);
}

export const addTransaction = defineOperation({
  ...write,
  name: "add_transaction",
  title: "Add transaction",
  description:
    "Record a transaction by hand in an account that is not synced from a bank (cash, a private loan, an account you keep manually or fill from files). Amount is in dollars: negative = money out, positive = money in. Date is YYYY-MM-DD. Rules and merchant cleanup apply as they do to imported rows; pass categoryId (from list_categories) to set the category yourself. By default the account balance moves by the amount; pass adjustBalance: false to leave it. Not allowed on bank-synced accounts, where the bank's own copy would duplicate it.",
  input: z.object({
    accountId: z.uuid(),
    date: DateStr,
    amount: z
      .number()
      .finite()
      .min(-1_000_000_000)
      .max(1_000_000_000)
      .refine((n) => n !== 0, "The amount can't be zero")
      .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "At most two decimal places")
      .describe("Dollars; negative = money out, positive = money in"),
    description: z.string().trim().min(1).max(200),
    categoryId: z.uuid().nullable().optional(),
    notes: z.string().max(2000).optional(),
    adjustBalance: z.boolean().default(true),
  }),
  async run(tx, p, i) {
    const [account] = await tx
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, i.accountId));
    if (!account) throw new OperationError("not_found", "That account doesn't exist.");
    if (account.connectionId)
      throw new OperationError(
        "conflict",
        "This account is synced from your bank, so transactions can't be added by hand. Use an account you keep manually.",
      );
    if (i.categoryId && !(await ownsAll(tx, "categories", [i.categoryId])))
      throw new OperationError("not_found", "That category doesn't exist.");

    const providerTransactionId = `manual:${randomUUID()}`;
    const amount = cents(i.amount);
    await ingestTransactions(
      tx,
      p.householdId,
      [
        {
          accountId: account.id,
          providerTransactionId,
          date: i.date,
          amount,
          pending: false,
          description: i.description,
        },
      ],
      // With a category chosen by the caller, don't let transfer matching file its partner.
      { skipTransferDetection: !!i.categoryId },
    );
    const set: Partial<typeof schema.transactions.$inferInsert> = { reviewed: true };
    if (i.categoryId) {
      set.categoryId = i.categoryId;
      set.categorySource = "user";
    }
    if (i.notes?.trim()) set.notes = i.notes.trim();
    const [row] = await tx
      .update(schema.transactions)
      .set(set)
      .where(
        and(
          eq(schema.transactions.accountId, account.id),
          eq(schema.transactions.providerTransactionId, providerTransactionId),
        ),
      )
      .returning({ id: schema.transactions.id });
    if (!row) throw new OperationError("conflict", "The transaction couldn't be saved.");
    if (i.adjustBalance) await shiftBalance(tx, p.householdId, account, amount);
    await refreshRecurring(tx, p.householdId);
    return { id: row.id };
  },
});

export const deleteTransaction = defineOperation({
  ...write,
  name: "delete_transaction",
  title: "Delete transaction",
  description:
    "Permanently delete one transaction that was added by hand or came from a file import, with the parts of its split if it has one. Transactions synced from a bank can't be deleted (the bank would send them again): set excluded with update_transaction instead. For a hand-added transaction the account balance moves back by its amount unless adjustBalance is false. This can't be undone.",
  destructive: true,
  input: z.object({ id: z.uuid(), adjustBalance: z.boolean().default(true) }),
  async run(tx, p, i) {
    const [txn] = await tx
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.id, i.id));
    if (!txn) throw new OperationError("not_found", "Transaction not found.");
    if (txn.splitParentId)
      throw new OperationError(
        "conflict",
        "This is one part of a split. Edit the split on the original transaction instead.",
      );
    const origin = transactionOrigin(txn.providerTransactionId);
    if (origin === "bank")
      throw new OperationError(
        "conflict",
        "This transaction comes from your bank and would come back on the next sync. Exclude it instead.",
      );
    await tx.delete(schema.transactions).where(eq(schema.transactions.id, txn.id));
    if (origin === "manual" && i.adjustBalance) {
      const [account] = await tx
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.id, txn.accountId));
      if (account && !account.connectionId)
        await shiftBalance(tx, p.householdId, account, -txn.amount);
    }
    await refreshRecurring(tx, p.householdId);
    return { deleted: true };
  },
});

export const TRANSACTION_OPERATIONS = [
  updateTransaction,
  updateTransactions,
  addTransaction,
  deleteTransaction,
] as const;
