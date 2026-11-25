import { type AccountType, addDays, matchTransfers } from "@mm/core";
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import type { Tx } from "./client";
import { accounts, categories, categoryGroups, transactions } from "./schema";

/**
 * After new transactions arrive, categorize moves between the household's own accounts as
 * transfers (see matchTransfers in @mm/core for what counts). Only uncategorized, posted,
 * unsplit rows are considered, and only pairs that include one of `freshIds`. Matched rows
 * get category_source = 'transfer' and stay unreviewed, so they show up for a person to check.
 * Returns the number of pairs found. Expects to run inside withHousehold().
 */
export async function detectTransfers(tx: Tx, freshIds: string[]): Promise<number> {
  if (freshIds.length === 0) return 0;
  const transferCategories = await tx
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .innerJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
    .where(and(eq(categoryGroups.kind, "transfer"), eq(categories.hidden, false)))
    .orderBy(categories.sortOrder, categories.name);
  const transfer = transferCategories.find((c) => c.name === "Transfer") ?? transferCategories[0];
  if (!transfer) return 0; // the household removed its transfer categories: nothing to file under
  const cardPayment = transferCategories.find((c) => c.name === "Credit Card Payment") ?? transfer;

  const open = and(
    isNull(transactions.categoryId),
    isNull(transactions.splitParentId),
    eq(transactions.isSplit, false),
    eq(transactions.excluded, false),
    eq(transactions.pending, false),
  );
  const fresh: { date: string }[] = [];
  for (let i = 0; i < freshIds.length; i += 1000) {
    fresh.push(
      ...(await tx
        .select({ date: transactions.date })
        .from(transactions)
        .where(and(inArray(transactions.id, freshIds.slice(i, i + 1000)), open))),
    );
  }
  if (fresh.length === 0) return 0;
  const dates = fresh.map((f) => f.date).sort();
  const freshSet = new Set(freshIds);
  const rows = await tx
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      accountType: accounts.type,
      date: transactions.date,
      amount: transactions.amount,
      description: transactions.rawDescription,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        open,
        gte(transactions.date, addDays(dates[0] as string, -3)),
        lte(transactions.date, addDays(dates[dates.length - 1] as string, 3)),
      ),
    );
  const pairs = matchTransfers(
    rows.map((r) => ({
      ...r,
      accountType: r.accountType as AccountType,
      fresh: freshSet.has(r.id),
    })),
  );
  for (const p of pairs) {
    await tx
      .update(transactions)
      .set({ categoryId: (p.cardPayment ? cardPayment : transfer).id, categorySource: "transfer" })
      // Still uncategorized: never replace a category set in the meantime.
      .where(and(inArray(transactions.id, [p.outId, p.inId]), isNull(transactions.categoryId)));
  }
  return pairs.length;
}
