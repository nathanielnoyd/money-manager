import { addMonths, budgetLine, endOfMonth, firstOfMonth, isLiability, todayIso } from "@mm/core";
import { schema } from "@mm/db";
import { and, asc, desc, eq, gte, ilike, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { defineOperation, OperationError } from "../operation";
import { DateStr, dollars } from "../util";

/**
 * Read-only operations. Every query runs inside the caller's household transaction
 * (row-level security), returns small result sets, and never includes account numbers
 * or masks. Amounts are dollars; spending is reported as positive numbers.
 */

const read = { minRole: "viewer", scope: "read", readOnly: true, idempotent: true } as const;
const Range = z.object({ start: DateStr, end: DateStr });

export const spendingByCategory = defineOperation({
  ...read,
  name: "spending_by_category",
  title: "Spending by category",
  description:
    "Total spending per category between two dates (inclusive). Excludes transfers and excluded transactions. Use for 'how much did we spend on X'.",
  input: Range,
  async run(tx, _p, { start, end }) {
    const { rows } = await tx.execute<{
      category: string;
      group: string;
      spent: string;
      count: number;
    }>(sql`
      select coalesce(c.name, 'Uncategorized') as category, coalesce(g.name, '') as group, sum(-t.amount) as spent, count(*)::int as count
      from transactions t left join categories c on c.id = t.category_id left join category_groups g on g.id = c.group_id
      where not t.excluded and not t.is_split and t.date between ${start}::date and ${end}::date
        and (g.kind = 'expense' or (g.kind is null and t.amount < 0))
      group by 1, 2 having sum(-t.amount) <> 0 order by 3 desc`);
    const total = rows.reduce((s, r) => s + Number(r.spent), 0);
    return {
      start,
      end,
      total: dollars(total),
      categories: rows.map((r) => ({
        category: r.category,
        group: r.group,
        spent: dollars(r.spent),
        transactions: r.count,
      })),
    };
  },
});

export const spendingByMerchant = defineOperation({
  ...read,
  name: "spending_by_merchant",
  title: "Top merchants",
  description: "Top merchants by spending between two dates, with transaction counts.",
  input: Range.extend({ limit: z.number().int().min(1).max(25).default(10) }),
  async run(tx, _p, { start, end, limit }) {
    const { rows } = await tx.execute<{ merchant: string; spent: string; count: number }>(sql`
      select m.name as merchant, sum(-t.amount) as spent, count(*)::int as count
      from transactions t join merchants m on m.id = t.merchant_id
      left join categories c on c.id = t.category_id left join category_groups g on g.id = c.group_id
      where not t.excluded and not t.is_split and t.date between ${start}::date and ${end}::date
        and (g.kind = 'expense' or (g.kind is null and t.amount < 0))
      group by 1 having sum(-t.amount) > 0 order by 2 desc limit ${limit}`);
    return rows.map((r) => ({
      merchant: r.merchant,
      spent: dollars(r.spent),
      transactions: r.count,
    }));
  },
});

export const monthlyTotals = defineOperation({
  ...read,
  name: "monthly_totals",
  title: "Monthly totals",
  description:
    "Income, expenses and net per calendar month between two dates. Use for trends and comparisons over time.",
  input: Range,
  async run(tx, _p, { start, end }) {
    const { rows } = await tx.execute<{ month: string; income: string; expenses: string }>(sql`
      select to_char(date_trunc('month', t.date), 'YYYY-MM') as month,
        coalesce(sum(t.amount) filter (where g.kind = 'income' or (g.kind is null and t.amount > 0)), 0) as income,
        coalesce(sum(-t.amount) filter (where g.kind = 'expense' or (g.kind is null and t.amount < 0)), 0) as expenses
      from transactions t left join categories c on c.id = t.category_id left join category_groups g on g.id = c.group_id
      where not t.excluded and not t.is_split and t.date between ${start}::date and ${end}::date
        and coalesce(g.kind::text, '') <> 'transfer'
      group by 1 order by 1`);
    return rows.map((r) => ({
      month: r.month,
      income: dollars(r.income),
      expenses: dollars(r.expenses),
      net: dollars(Number(r.income) - Number(r.expenses)),
    }));
  },
});

export const searchTransactions = defineOperation({
  ...read,
  name: "search_transactions",
  title: "Search transactions",
  description:
    "Find individual transactions by text (merchant or description), category name, date range and minimum absolute amount. Set `uncategorized` or `unreviewed` to find work to do. Returns at most `limit` rows, newest first, each with its id. Amounts are dollars: negative = money out, positive = money in.",
  input: Range.extend({
    text: z.string().max(80).optional(),
    category: z.string().max(60).optional().describe("Category name (case-insensitive)"),
    minAmount: z.number().min(0).optional().describe("Minimum absolute amount in dollars"),
    uncategorized: z.boolean().optional().describe("Only transactions without a category"),
    unreviewed: z.boolean().optional().describe("Only transactions not yet marked reviewed"),
    limit: z.number().int().min(1).max(100).default(10),
  }),
  async run(tx, _p, i) {
    const t = schema.transactions;
    const like = i.text ? `%${i.text.replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
    const rows = await tx
      .select({
        id: t.id,
        date: t.date,
        amount: t.amount,
        description: t.rawDescription,
        merchant: schema.merchants.name,
        category: schema.categories.name,
        account: schema.accounts.name,
        pending: t.pending,
        reviewed: t.reviewed,
        notes: t.notes,
      })
      .from(t)
      .innerJoin(schema.accounts, eq(schema.accounts.id, t.accountId))
      .leftJoin(schema.merchants, eq(schema.merchants.id, t.merchantId))
      .leftJoin(schema.categories, eq(schema.categories.id, t.categoryId))
      .where(
        and(
          isNull(t.splitParentId),
          gte(t.date, i.start),
          lte(t.date, i.end),
          like ? or(ilike(t.rawDescription, like), ilike(schema.merchants.name, like)) : undefined,
          i.category ? sql`lower(${schema.categories.name}) = lower(${i.category})` : undefined,
          i.minAmount ? sql`abs(${t.amount}) >= ${Math.round(i.minAmount * 100)}` : undefined,
          i.uncategorized ? and(isNull(t.categoryId), eq(t.isSplit, false)) : undefined,
          i.unreviewed ? eq(t.reviewed, false) : undefined,
        ),
      )
      .orderBy(desc(t.date), desc(t.id))
      .limit(i.limit);
    return rows.map((r) => ({
      id: r.id,
      date: r.date,
      merchant: r.merchant ?? r.description,
      amount: dollars(r.amount),
      category: r.category ?? "Uncategorized",
      account: r.account,
      pending: r.pending,
      ...(r.reviewed ? {} : { reviewed: false }),
      ...(r.notes ? { notes: r.notes } : {}),
    }));
  },
});

export const getTransaction = defineOperation({
  ...read,
  name: "get_transaction",
  title: "Get transaction",
  description:
    "One transaction in full: raw bank description, merchant, category (with id), notes, flags, and split parts if it was split.",
  input: z.object({ id: z.uuid() }),
  async run(tx, _p, { id }) {
    const t = schema.transactions;
    const cols = {
      id: t.id,
      date: t.date,
      amount: t.amount,
      description: t.rawDescription,
      merchant: schema.merchants.name,
      categoryId: t.categoryId,
      category: schema.categories.name,
      categorySource: t.categorySource,
      accountId: t.accountId,
      account: schema.accounts.name,
      pending: t.pending,
      reviewed: t.reviewed,
      excluded: t.excluded,
      isSplit: t.isSplit,
      splitParentId: t.splitParentId,
      notes: t.notes,
    };
    const base = tx
      .select(cols)
      .from(t)
      .innerJoin(schema.accounts, eq(schema.accounts.id, t.accountId))
      .leftJoin(schema.merchants, eq(schema.merchants.id, t.merchantId))
      .leftJoin(schema.categories, eq(schema.categories.id, t.categoryId));
    const [row] = await base.where(eq(t.id, id));
    if (!row) throw new OperationError("not_found", "Transaction not found.");
    const parts = row.isSplit
      ? await tx
          .select({
            id: t.id,
            amount: t.amount,
            category: schema.categories.name,
            notes: t.notes,
          })
          .from(t)
          .leftJoin(schema.categories, eq(schema.categories.id, t.categoryId))
          .where(eq(t.splitParentId, id))
      : [];
    return {
      ...row,
      amount: dollars(row.amount),
      ...(parts.length
        ? { splitParts: parts.map((p) => ({ ...p, amount: dollars(p.amount) })) }
        : {}),
    };
  },
});

export const accountBalances = defineOperation({
  ...read,
  name: "account_balances",
  title: "Account balances",
  description:
    "Current balance of every visible account (liabilities shown as amounts owed) and total net worth.",
  input: z.object({}),
  async run(tx) {
    const rows = await tx
      .select({
        name: schema.accounts.name,
        type: schema.accounts.type,
        balance: schema.accounts.currentBalance,
        inNetWorth: schema.accounts.includeInNetWorth,
      })
      .from(schema.accounts)
      .where(eq(schema.accounts.hidden, false))
      .orderBy(asc(schema.accounts.sortOrder));
    const net = rows
      .filter((r) => r.inNetWorth)
      .reduce((s, r) => s + (isLiability(r.type) ? -r.balance : r.balance), 0);
    return {
      netWorth: dollars(net),
      accounts: rows.map((r) => ({
        name: r.name,
        type: r.type,
        ...(isLiability(r.type) ? { owed: dollars(r.balance) } : { balance: dollars(r.balance) }),
      })),
    };
  },
});

export const listAccounts = defineOperation({
  ...read,
  name: "list_accounts",
  title: "List accounts",
  description:
    "Every account with its id, type, balance and flags. Use the ids for rules (account conditions) and goals. Liabilities report `owed`.",
  input: z.object({ includeHidden: z.boolean().default(false) }),
  async run(tx, _p, { includeHidden }) {
    const a = schema.accounts;
    const rows = await tx
      .select({
        id: a.id,
        name: a.name,
        type: a.type,
        subtype: a.subtype,
        balance: a.currentBalance,
        creditLimit: a.creditLimit,
        hidden: a.hidden,
        includeInNetWorth: a.includeInNetWorth,
        balanceUpdatedAt: a.balanceUpdatedAt,
      })
      .from(a)
      .where(includeHidden ? undefined : eq(a.hidden, false))
      .orderBy(asc(a.sortOrder), asc(a.name));
    return rows.map(({ balance, creditLimit, ...r }) => ({
      ...r,
      ...(isLiability(r.type) ? { owed: dollars(balance) } : { balance: dollars(balance) }),
      ...(creditLimit != null ? { creditLimit: dollars(creditLimit) } : {}),
    }));
  },
});

export const listCategories = defineOperation({
  ...read,
  name: "list_categories",
  title: "List categories",
  description:
    "All category groups and their categories, with ids. Use the ids when categorizing transactions, writing rules or setting budgets.",
  input: z.object({ includeHidden: z.boolean().default(false) }),
  async run(tx, _p, { includeHidden }) {
    const groups = await tx
      .select()
      .from(schema.categoryGroups)
      .orderBy(asc(schema.categoryGroups.sortOrder));
    const cats = await tx
      .select()
      .from(schema.categories)
      .where(includeHidden ? undefined : eq(schema.categories.hidden, false))
      .orderBy(asc(schema.categories.sortOrder));
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      kind: g.kind,
      categories: cats
        .filter((c) => c.groupId === g.id)
        .map((c) => ({
          id: c.id,
          name: c.name,
          ...(c.hidden ? { hidden: true } : {}),
          ...(c.rollover ? { rollover: true } : {}),
        })),
    }));
  },
});

export const listRules = defineOperation({
  ...read,
  name: "list_rules",
  title: "List rules",
  description:
    "Categorization rules in priority order (higher runs first), with conditions and actions. Amount conditions are in dollars.",
  input: z.object({}),
  async run(tx) {
    const rows = await tx
      .select()
      .from(schema.rules)
      .orderBy(desc(schema.rules.priority), asc(schema.rules.createdAt));
    const cats = await tx
      .select({ id: schema.categories.id, name: schema.categories.name })
      .from(schema.categories);
    const catName = new Map(cats.map((c) => [c.id, c.name]));
    return rows.map((r) => {
      const actions = r.actions as Record<string, unknown>;
      const setCategoryId = actions.setCategoryId as string | null | undefined;
      return {
        id: r.id,
        name: r.name,
        priority: r.priority,
        enabled: r.enabled,
        conditions: (r.conditions as Record<string, unknown>[]).map((c) =>
          c.field === "amount"
            ? {
                ...c,
                value: dollars(c.value as number),
                ...(c.value2 != null ? { value2: dollars(c.value2 as number) } : {}),
              }
            : c,
        ),
        actions: {
          ...actions,
          ...(setCategoryId ? { setCategoryName: catName.get(setCategoryId) ?? null } : {}),
        },
      };
    });
  },
});

export const budgetStatus = defineOperation({
  ...read,
  name: "budget_status",
  title: "Budget status",
  description:
    "Budgeted vs spent per category for a month (YYYY-MM-01), with each category's id and status.",
  input: z.object({ month: DateStr }),
  async run(tx, _p, { month }) {
    const m = firstOfMonth(month);
    const { rows } = await tx.execute<{
      category_id: string;
      category: string;
      budgeted: string;
      spent: string;
    }>(sql`
      select b.category_id, c.name as category, b.amount as budgeted,
        coalesce((select sum(-t.amount) from transactions t where t.category_id = b.category_id and not t.excluded and not t.is_split
          and t.date between ${m}::date and ${endOfMonth(m)}::date), 0) as spent
      from budget_items b join categories c on c.id = b.category_id where b.month = ${m}::date order by c.name`);
    return rows.map((r) => {
      const l = budgetLine(Number(r.budgeted), Number(r.spent));
      return {
        categoryId: r.category_id,
        category: r.category,
        budgeted: dollars(r.budgeted),
        spent: dollars(r.spent),
        remaining: dollars(l.remaining),
        status: l.status,
      };
    });
  },
});

export const recurringCharges = defineOperation({
  ...read,
  name: "recurring_charges",
  title: "Recurring charges",
  description:
    "Detected subscriptions, bills and regular income with cadence, typical amount and next expected date.",
  input: z.object({}),
  async run(tx) {
    const rows = await tx
      .select({
        merchant: schema.merchants.name,
        direction: schema.recurringSeries.direction,
        cadence: schema.recurringSeries.cadence,
        amount: schema.recurringSeries.expectedAmount,
        next: schema.recurringSeries.nextDate,
        change: schema.recurringSeries.priceChange,
      })
      .from(schema.recurringSeries)
      .innerJoin(schema.merchants, eq(schema.merchants.id, schema.recurringSeries.merchantId))
      .where(eq(schema.recurringSeries.status, "active"))
      .orderBy(asc(schema.recurringSeries.nextDate));
    return rows.map((r) => ({
      merchant: r.merchant,
      type: r.direction === "in" ? "income" : "bill",
      cadence: r.cadence,
      amount: dollars(Math.abs(r.amount)),
      nextExpected: r.next,
      ...(r.change ? { recentPriceChange: dollars(-r.change) } : {}),
    }));
  },
});

export const netWorthHistory = defineOperation({
  ...read,
  name: "net_worth_history",
  title: "Net worth history",
  description: "Net worth, assets and liabilities at the start of each month between two dates.",
  input: Range,
  async run(tx, _p, { start, end }) {
    const out: { month: string; netWorth: number; assets: number; liabilities: number }[] = [];
    for (let m = firstOfMonth(start); m <= end && out.length < 36; m = addMonths(m, 1)) {
      const { rows } = await tx.execute<{
        assets: string | null;
        liabilities: string | null;
      }>(sql`
        select sum(case when a.type in ('credit','loan') then 0 else s.balance end) as assets,
               sum(case when a.type in ('credit','loan') then s.balance else 0 end) as liabilities
        from accounts a join lateral (
          select balance from balance_snapshots b where b.account_id = a.id and b.date <= ${m}::date order by b.date desc limit 1
        ) s on true where a.include_in_net_worth`);
      const a = Number(rows[0]?.assets ?? 0);
      const l = Number(rows[0]?.liabilities ?? 0);
      if (a || l)
        out.push({
          month: m.slice(0, 7),
          netWorth: dollars(a - l),
          assets: dollars(a),
          liabilities: dollars(l),
        });
    }
    return out;
  },
});

export const listGoals = defineOperation({
  ...read,
  name: "list_goals",
  title: "List goals",
  description:
    "Savings goals with target, current progress (from linked accounts or a manual amount), target date and the monthly amount needed to stay on track.",
  input: z.object({}),
  async run(tx) {
    const goals = await tx
      .select()
      .from(schema.goals)
      .where(eq(schema.goals.archived, false))
      .orderBy(asc(schema.goals.createdAt));
    const accounts = await tx
      .select({
        id: schema.accounts.id,
        name: schema.accounts.name,
        type: schema.accounts.type,
        balance: schema.accounts.currentBalance,
      })
      .from(schema.accounts);
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const today = todayIso();
    return goals.map((g) => {
      const linked = g.accountIds.map((id) => byId.get(id)).filter((a) => !!a);
      const current = linked.length
        ? linked.reduce((t, a) => t + (isLiability(a.type) ? -a.balance : a.balance), 0)
        : g.manualAmount;
      const remaining = Math.max(0, g.targetAmount - current);
      const days = g.targetDate ? (Date.parse(g.targetDate) - Date.parse(today)) / 86_400_000 : 0;
      const monthsLeft = g.targetDate ? Math.max(0, days / 30.44) : null;
      return {
        id: g.id,
        name: g.name,
        targetAmount: dollars(g.targetAmount),
        targetDate: g.targetDate,
        current: dollars(current),
        remaining: dollars(remaining),
        progress: Math.round(Math.min(1, Math.max(0, current / g.targetAmount)) * 1000) / 1000,
        linkedAccounts: linked.map((a) => ({ id: a.id, name: a.name })),
        ...(linked.length ? {} : { manualAmount: dollars(g.manualAmount) }),
        ...(monthsLeft === null
          ? {}
          : {
              neededPerMonth: dollars(
                monthsLeft < 1 ? remaining : Math.ceil(remaining / monthsLeft),
              ),
            }),
      };
    });
  },
});

export const READ_OPERATIONS = [
  accountBalances,
  listAccounts,
  netWorthHistory,
  searchTransactions,
  getTransaction,
  spendingByCategory,
  spendingByMerchant,
  monthlyTotals,
  budgetStatus,
  recurringCharges,
  listCategories,
  listRules,
  listGoals,
] as const;
