import "server-only";
import {
  addMonths,
  budgetLine,
  endOfMonth,
  firstOfMonth,
  rolloverCarry,
  suggestBudget,
  todayIso,
} from "@mm/core";
import { schema, type Tx } from "@mm/db";
import { asc, eq, lte, sql } from "drizzle-orm";

/** Validates ?month=YYYY-MM, defaulting to the current month. Returns YYYY-MM-01. */
export function parseMonth(raw: unknown): string {
  return typeof raw === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw)
    ? `${raw}-01`
    : firstOfMonth(todayIso());
}

const n = (v: unknown) => Number(v ?? 0);

/** Net amount per category per month: { "catId|YYYY-MM-01": signed minor units }. */
async function monthlyTotals(tx: Tx, from: string, to: string) {
  const { rows } = await tx.execute<{ category_id: string; m: string; total: string }>(sql`
    select category_id, to_char(date_trunc('month', date), 'YYYY-MM-01') as m, sum(amount) as total
    from transactions
    where category_id is not null and not excluded and not is_split
      and date >= ${from} and date <= ${to}
    group by 1, 2`);
  return new Map(rows.map((r) => [`${r.category_id}|${r.m}`, n(r.total)]));
}

export async function getBudgetMonth(tx: Tx, householdId: string, month: string) {
  const end = endOfMonth(month);
  const historyStart = addMonths(month, -24);
  const [household] = await tx
    .select({ budgetMode: schema.households.budgetMode })
    .from(schema.households)
    .where(eq(schema.households.id, householdId));
  const cats = await tx
    .select({
      id: schema.categories.id,
      name: schema.categories.name,
      hidden: schema.categories.hidden,
      rollover: schema.categories.rollover,
      groupId: schema.categoryGroups.id,
      group: schema.categoryGroups.name,
      kind: schema.categoryGroups.kind,
    })
    .from(schema.categories)
    .innerJoin(schema.categoryGroups, eq(schema.categoryGroups.id, schema.categories.groupId))
    .orderBy(
      asc(schema.categoryGroups.sortOrder),
      asc(schema.categories.sortOrder),
      asc(schema.categories.name),
    );
  const items = await tx
    .select({
      categoryId: schema.budgetItems.categoryId,
      month: schema.budgetItems.month,
      amount: schema.budgetItems.amount,
    })
    .from(schema.budgetItems)
    .where(lte(schema.budgetItems.month, month));
  const budgeted = new Map(items.map((i) => [`${i.categoryId}|${i.month}`, i.amount]));
  const totals = await monthlyTotals(tx, historyStart, end);

  const { rows: unc } = await tx.execute<{ spent: string | null; count: number }>(sql`
    select sum(-amount) as spent, count(*)::int as count from transactions
    where category_id is null and amount < 0 and not excluded and not is_split
      and date >= ${month} and date <= ${end}`);

  const months = Array.from({ length: 25 }, (_, i) => addMonths(historyStart, i)).filter(
    (m) => m <= month,
  );
  const lines = cats
    .filter((c) => c.kind !== "transfer")
    .map((c) => {
      const sign = c.kind === "income" ? 1 : -1;
      const actualFor = (m: string) => sign * (totals.get(`${c.id}|${m}`) ?? 0);
      const budget = budgeted.get(`${c.id}|${month}`) ?? 0;
      const actual = actualFor(month);
      const carry =
        c.rollover && c.kind === "expense"
          ? rolloverCarry(
              months.map((m) => ({
                month: m,
                budgeted: budgeted.get(`${c.id}|${m}`) ?? 0,
                spent: actualFor(m),
              })),
              month,
            )
          : 0;
      return {
        ...c,
        line: budgetLine(budget, actual, carry),
        suggested: suggestBudget([1, 2, 3].map((k) => actualFor(addMonths(month, -k)))),
      };
    })
    .filter((l) => !l.hidden || l.line.budgeted > 0 || l.line.spent !== 0);

  const expense = lines.filter((l) => l.kind === "expense");
  const income = lines.filter((l) => l.kind === "income");
  const plannedIncome = income.reduce((t, l) => t + l.line.budgeted, 0);
  const actualIncome = income.reduce((t, l) => t + l.line.spent, 0);
  return {
    month,
    budgetMode: household?.budgetMode ?? "flexible",
    expense,
    income,
    totals: {
      budgeted: expense.reduce((t, l) => t + l.line.budgeted, 0),
      spent: expense.reduce((t, l) => t + l.line.spent, 0),
      available: expense.reduce((t, l) => t + Math.max(0, l.line.available), 0),
      plannedIncome,
      actualIncome,
    },
    uncategorized: { spent: n(unc[0]?.spent), count: unc[0]?.count ?? 0 },
  };
}

export type BudgetMonth = Awaited<ReturnType<typeof getBudgetMonth>>;

/** Income vs expenses per month (transfers excluded), plus category and merchant breakdowns. */
export async function getCashFlow(tx: Tx, from: string, to: string) {
  const { rows: monthly } = await tx.execute<{ m: string; income: string; expense: string }>(sql`
    select to_char(date_trunc('month', t.date), 'YYYY-MM-01') as m,
      coalesce(sum(t.amount) filter (where g.kind = 'income' or (g.kind is null and t.amount > 0)), 0) as income,
      coalesce(sum(-t.amount) filter (where g.kind = 'expense' or (g.kind is null and t.amount < 0)), 0) as expense
    from transactions t
    left join categories c on c.id = t.category_id
    left join category_groups g on g.id = c.group_id
    where not t.excluded and not t.is_split and t.date >= ${from} and t.date <= ${to}
      and coalesce(g.kind::text, '') <> 'transfer'
    group by 1 order by 1`);

  const { rows: byCategory } = await tx.execute<{
    id: string | null;
    name: string | null;
    grp: string | null;
    spent: string;
  }>(sql`
    select c.id, c.name, g.name as grp, sum(-t.amount) as spent
    from transactions t
    left join categories c on c.id = t.category_id
    left join category_groups g on g.id = c.group_id
    where not t.excluded and not t.is_split and t.date >= ${from} and t.date <= ${to}
      and (g.kind = 'expense' or (g.kind is null and t.amount < 0))
    group by 1, 2, 3 having sum(-t.amount) > 0 order by 4 desc`);

  const { rows: byMerchant } = await tx.execute<{ name: string; spent: string; count: number }>(sql`
    select m.name, sum(-t.amount) as spent, count(*)::int as count
    from transactions t
    join merchants m on m.id = t.merchant_id
    left join categories c on c.id = t.category_id
    left join category_groups g on g.id = c.group_id
    where not t.excluded and not t.is_split and t.date >= ${from} and t.date <= ${to}
      and (g.kind = 'expense' or (g.kind is null and t.amount < 0))
    group by 1 having sum(-t.amount) > 0 order by 2 desc limit 10`);

  // Every month in the range appears, even with no activity, so the time axis stays continuous.
  const byMonth = new Map(monthly.map((r) => [r.m, r]));
  const series: { month: string; income: number; expense: number }[] = [];
  for (let m = firstOfMonth(from); m <= to; m = addMonths(m, 1)) {
    const r = byMonth.get(m);
    series.push({ month: m, income: n(r?.income), expense: n(r?.expense) });
  }
  const income = series.reduce((t, r) => t + r.income, 0);
  const expense = series.reduce((t, r) => t + r.expense, 0);
  return {
    series,
    income,
    expense,
    net: income - expense,
    savingsRate: income > 0 ? (income - expense) / income : null,
    byCategory: byCategory.map((r) => ({
      id: r.id,
      name: r.name ?? "Uncategorized",
      group: r.grp ?? "Uncategorized",
      spent: n(r.spent),
    })),
    byMerchant: byMerchant.map((r) => ({ name: r.name, spent: n(r.spent), count: r.count })),
  };
}
