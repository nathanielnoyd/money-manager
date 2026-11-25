import "server-only";
import { addDays, todayIso } from "@mm/core";
import { schema, type Tx } from "@mm/db";
import { and, asc, eq, gte, lte } from "drizzle-orm";

export async function listRecurring(tx: Tx) {
  return tx
    .select({
      id: schema.recurringSeries.id,
      merchant: schema.merchants.name,
      direction: schema.recurringSeries.direction,
      cadence: schema.recurringSeries.cadence,
      expectedAmount: schema.recurringSeries.expectedAmount,
      lastAmount: schema.recurringSeries.lastAmount,
      lastDate: schema.recurringSeries.lastDate,
      nextDate: schema.recurringSeries.nextDate,
      occurrences: schema.recurringSeries.occurrences,
      priceChange: schema.recurringSeries.priceChange,
      status: schema.recurringSeries.status,
      category: schema.categories.name,
    })
    .from(schema.recurringSeries)
    .innerJoin(schema.merchants, eq(schema.merchants.id, schema.recurringSeries.merchantId))
    .leftJoin(schema.categories, eq(schema.categories.id, schema.recurringSeries.categoryId))
    .orderBy(asc(schema.recurringSeries.nextDate));
}

/** Active recurring charges and income expected in the next `days` days. */
export async function upcoming(tx: Tx, days = 14) {
  const today = todayIso();
  return tx
    .select({
      id: schema.recurringSeries.id,
      merchant: schema.merchants.name,
      amount: schema.recurringSeries.expectedAmount,
      nextDate: schema.recurringSeries.nextDate,
      direction: schema.recurringSeries.direction,
    })
    .from(schema.recurringSeries)
    .innerJoin(schema.merchants, eq(schema.merchants.id, schema.recurringSeries.merchantId))
    .where(
      and(
        eq(schema.recurringSeries.status, "active"),
        gte(schema.recurringSeries.nextDate, today),
        lte(schema.recurringSeries.nextDate, addDays(today, days)),
      ),
    )
    .orderBy(asc(schema.recurringSeries.nextDate));
}
