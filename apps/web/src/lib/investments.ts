import "server-only";
import { addDays, allocation, modifiedDietz, todayIso, unrealizedGain } from "@mm/core";
import { schema, type Tx } from "@mm/db";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";

export const RANGES = { "1m": 30, "3m": 91, "1y": 365, all: 3650 } as const;
export type Range = keyof typeof RANGES;

export async function getInvestments(tx: Tx, range: Range) {
  const today = todayIso();
  const start = addDays(today, -RANGES[range]);
  const accounts = await tx
    .select({
      id: schema.accounts.id,
      name: schema.accounts.name,
      balance: schema.accounts.currentBalance,
      manual: isNull(schema.accounts.connectionId),
    })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.type, "investment"), eq(schema.accounts.hidden, false)))
    .orderBy(asc(schema.accounts.sortOrder));
  const ids = accounts.map((a) => a.id);
  if (ids.length === 0) return null;

  const holdings = await tx
    .select({
      id: schema.holdings.id,
      accountId: schema.holdings.accountId,
      account: schema.accounts.name,
      quantity: schema.holdings.quantity,
      value: schema.holdings.value,
      costBasis: schema.holdings.costBasis,
      symbol: schema.securities.symbol,
      name: schema.securities.name,
      type: schema.securities.type,
      price: schema.securities.price,
    })
    .from(schema.holdings)
    .innerJoin(schema.securities, eq(schema.securities.id, schema.holdings.securityId))
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.holdings.accountId))
    .where(inArray(schema.holdings.accountId, ids))
    .orderBy(desc(schema.holdings.value));

  const series = await tx
    .select({
      date: schema.balanceSnapshots.date,
      value: sql<string>`sum(${schema.balanceSnapshots.balance})`,
    })
    .from(schema.balanceSnapshots)
    .where(
      and(
        inArray(schema.balanceSnapshots.accountId, ids),
        gte(schema.balanceSnapshots.date, start),
      ),
    )
    .groupBy(schema.balanceSnapshots.date)
    .orderBy(schema.balanceSnapshots.date);
  const flows = await tx
    .select({ date: schema.transactions.date, amount: schema.transactions.amount })
    .from(schema.transactions)
    .where(
      and(
        inArray(schema.transactions.accountId, ids),
        gte(schema.transactions.date, start),
        eq(schema.transactions.isSplit, false),
      ),
    );

  const points = series.map((r) => ({ date: r.date, value: Number(r.value) }));
  const endValue = accounts.reduce((t, a) => t + a.balance, 0);
  const startPoint = points[0];
  const perf = startPoint
    ? modifiedDietz(
        startPoint.value,
        endValue,
        flows.filter((f) => f.date > startPoint.date),
        startPoint.date,
        today,
      )
    : null;

  return {
    accounts,
    holdings,
    series: points,
    total: endValue,
    performance: perf,
    allocation: allocation(holdings),
    unrealized: unrealizedGain(holdings),
  };
}

export type InvestmentsData = NonNullable<Awaited<ReturnType<typeof getInvestments>>>;
