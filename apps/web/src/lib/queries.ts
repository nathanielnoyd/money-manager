import "server-only";
import { addDays, netWorth, todayIso } from "@mm/core";
import { schema, withHousehold } from "@mm/db";
import { asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";

const n = (v: unknown) => Number(v ?? 0);

export async function getDashboard(householdId: string) {
  return withHousehold(db(), householdId, async (tx) => {
    const accounts = await tx
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.hidden, false))
      .orderBy(asc(schema.accounts.sortOrder));

    const series = await tx.execute<{ date: string; value: string }>(sql`
      select s.date::text as date,
             sum(case when a.type in ('credit','loan') then -s.balance else s.balance end) as value
      from balance_snapshots s join accounts a on a.id = s.account_id
      where a.include_in_net_worth and s.date >= current_date - 365
      group by s.date order by s.date`);

    // Month-to-date spending vs the same span of last month (a fair comparison mid-month).
    const spending = await tx.execute<{ this_month: string | null; last_month: string | null }>(sql`
      select
        sum(-t.amount) filter (where t.date >= date_trunc('month', current_date)) as this_month,
        sum(-t.amount) filter (where t.date < date_trunc('month', current_date)
                                 and t.date <= current_date - interval '1 month') as last_month
      from transactions t
      join categories c on c.id = t.category_id
      join category_groups g on g.id = c.group_id
      where g.kind = 'expense' and not t.excluded and not t.is_split
        and t.date >= date_trunc('month', current_date) - interval '1 month'`);

    const byCategory = await tx.execute<{ name: string; spent: string }>(sql`
      select c.name, sum(-t.amount) as spent
      from transactions t
      join categories c on c.id = t.category_id
      join category_groups g on g.id = c.group_id
      where g.kind = 'expense' and not t.excluded and not t.is_split and t.date >= date_trunc('month', current_date)
      group by c.name having sum(-t.amount) > 0 order by 2 desc limit 6`);

    const recent = await recentTransactions(tx, 8);

    const points = series.rows.map((r) => ({ date: r.date, value: n(r.value) }));
    const current = netWorth(accounts);
    const monthAgo = points.find((p) => p.date >= isoDaysAgo(30))?.value ?? current;
    const spentThisMonth = n(spending.rows[0]?.this_month);
    const spentLastMonth = n(spending.rows[0]?.last_month);

    return {
      accounts,
      netWorth: current,
      netWorthChange30d: current - monthAgo,
      series: points,
      spentThisMonth,
      spentLastMonth,
      byCategory: byCategory.rows.map((r) => ({ name: r.name, spent: n(r.spent) })),
      recent,
    };
  });
}

export async function getTransactions(householdId: string, limit = 100) {
  return withHousehold(db(), householdId, (tx) => recentTransactions(tx, limit));
}

async function recentTransactions(
  tx: Parameters<Parameters<typeof withHousehold>[2]>[0],
  limit: number,
) {
  return tx
    .select({
      id: schema.transactions.id,
      date: schema.transactions.date,
      amount: schema.transactions.amount,
      pending: schema.transactions.pending,
      raw: schema.transactions.rawDescription,
      merchant: schema.merchants.name,
      category: schema.categories.name,
      account: schema.accounts.name,
    })
    .from(schema.transactions)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.transactions.accountId))
    .leftJoin(schema.merchants, eq(schema.merchants.id, schema.transactions.merchantId))
    .leftJoin(schema.categories, eq(schema.categories.id, schema.transactions.categoryId))
    .where(isNull(schema.transactions.splitParentId))
    .orderBy(desc(schema.transactions.date), desc(schema.transactions.id))
    .limit(limit);
}

export async function getAccounts(householdId: string) {
  return withHousehold(db(), householdId, (tx) =>
    tx.select().from(schema.accounts).orderBy(asc(schema.accounts.sortOrder)),
  );
}

const isoDaysAgo = (days: number) => addDays(todayIso(), -days);

/** Daily assets and liabilities (positive amounts) over the last year, from balance snapshots. */
export async function getNetWorthBreakdown(householdId: string) {
  return withHousehold(db(), householdId, async (tx) => {
    const { rows } = await tx.execute<{ date: string; assets: string; liabilities: string }>(sql`
      select s.date::text as date,
             sum(case when a.type in ('credit','loan') then 0 else s.balance end) as assets,
             sum(case when a.type in ('credit','loan') then s.balance else 0 end) as liabilities
      from balance_snapshots s join accounts a on a.id = s.account_id
      where a.include_in_net_worth and s.date >= current_date - 365
      group by s.date order by s.date`);
    return rows.map((r) => ({
      date: r.date,
      assets: Number(r.assets),
      liabilities: Number(r.liabilities),
    }));
  });
}
