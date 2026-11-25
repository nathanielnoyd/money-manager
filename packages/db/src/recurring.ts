import { addDays, detectRecurring, todayIso } from "@mm/core";
import { and, eq, gte, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import type { Tx } from "./client";
import { categories, categoryGroups, recurringSeries, transactions } from "./schema";

/**
 * Re-detect recurring series from the last ~13 months of transactions and upsert them.
 * Series the user dismissed stay dismissed; series no longer detected are removed.
 * Runs inside `withHousehold`.
 */
export async function refreshRecurring(
  tx: Tx,
  householdId: string,
  today = todayIso(),
): Promise<number> {
  const rows = await tx
    .select({
      merchantId: transactions.merchantId,
      date: transactions.date,
      amount: transactions.amount,
      categoryId: transactions.categoryId,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
    .where(
      and(
        isNotNull(transactions.merchantId),
        isNull(transactions.splitParentId),
        eq(transactions.pending, false),
        eq(transactions.excluded, false),
        gte(transactions.date, addDays(today, -400)),
        // Transfers between your own accounts (card payments, savings, 401k) aren't bills or income.
        sql`coalesce(${categoryGroups.kind}::text, '') <> 'transfer'`,
      ),
    );
  const detected = detectRecurring(
    rows.map((r) => ({ ...r, merchantId: r.merchantId as string })),
    today,
  );

  for (const s of detected) {
    const values = {
      householdId,
      merchantId: s.merchantId,
      direction: s.direction,
      cadence: s.cadence,
      intervalDays: s.intervalDays,
      expectedAmount: s.expectedAmount,
      lastAmount: s.lastAmount,
      lastDate: s.lastDate,
      nextDate: s.nextDate,
      occurrences: s.occurrences,
      categoryId: s.categoryId,
      priceChange: s.priceChange,
    };
    const { householdId: _h, merchantId: _m, direction: _d, ...update } = values;
    await tx
      .insert(recurringSeries)
      .values(values)
      .onConflictDoUpdate({
        target: [recurringSeries.merchantId, recurringSeries.direction],
        set: update,
      });
  }

  const keep = detected.map((s) => `${s.merchantId}|${s.direction}`);
  await tx
    .delete(recurringSeries)
    .where(
      and(
        eq(recurringSeries.status, "active"),
        keep.length
          ? notInArray(
              sql`${recurringSeries.merchantId}::text || '|' || ${recurringSeries.direction}`,
              keep,
            )
          : undefined,
      ),
    );
  return detected.length;
}
