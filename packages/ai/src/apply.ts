import { addDays, categoryAnomalies, firstOfMonth, todayIso, unusualCharges } from "@mm/core";
import { type Db, schema, type Tx, withHousehold } from "@mm/db";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { assertAiBudget } from "./budget";
import { categorizeTransactions } from "./categorize";
import type { Ai, AiUsage } from "./client";
import { type Digest, type DigestFacts, writeDigest } from "./digest";

export async function recordAiUsage(
  tx: Tx,
  householdId: string,
  feature: string,
  u: AiUsage,
): Promise<void> {
  if (u.inputTokens === 0 && u.outputTokens === 0) return;
  await tx.insert(schema.aiUsage).values({
    householdId,
    feature,
    model: u.model,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
  });
}

/**
 * Suggest categories for uncategorized transactions and apply confident ones.
 * Reads, then calls the model with no database transaction open, then writes.
 * Applied rows stay "needs review" and are marked category_source = 'ai'.
 */
export async function categorizeUncategorized(
  db: Db,
  householdId: string,
  ai: Ai,
  opts: { since?: Date; limit?: number } = {},
): Promise<{ considered: number; applied: number }> {
  const t = schema.transactions;
  const read = await withHousehold(db, householdId, async (tx) => {
    await assertAiBudget(tx, householdId);
    const rows = await tx
      .select({ id: t.id, description: t.rawDescription, amount: t.amount })
      .from(t)
      .where(
        and(
          isNull(t.categoryId),
          eq(t.isSplit, false),
          eq(t.excluded, false),
          opts.since ? gte(t.createdAt, opts.since) : undefined,
        ),
      )
      .orderBy(desc(t.date))
      .limit(Math.min(opts.limit ?? 200, 500));
    const categories = await tx
      .select({
        id: schema.categories.id,
        name: schema.categories.name,
        group: schema.categoryGroups.name,
        kind: schema.categoryGroups.kind,
      })
      .from(schema.categories)
      .innerJoin(schema.categoryGroups, eq(schema.categoryGroups.id, schema.categories.groupId))
      .where(eq(schema.categories.hidden, false));
    // The household's own past choices, one per merchant, as examples.
    const { rows: examples } = await tx.execute<{ description: string; category: string }>(sql`
      select distinct on (t.merchant_id) t.raw_description as description, c.name as category
      from transactions t join categories c on c.id = t.category_id
      where t.category_source in ('user', 'rule') and t.merchant_id is not null
      order by t.merchant_id, t.date desc limit 40`);
    return { rows, categories, examples };
  });
  if (read.rows.length === 0 || read.categories.length === 0) return { considered: 0, applied: 0 };

  const { suggestions, usage } = await categorizeTransactions(ai, {
    categories: read.categories,
    examples: read.examples,
    transactions: read.rows.map((r, ref) => ({
      ref,
      description: r.description,
      amount: r.amount,
    })),
  });
  const byName = new Map(read.categories.map((c) => [c.name, c.id]));

  const applied = await withHousehold(db, householdId, async (tx) => {
    let n = 0;
    for (const s of suggestions) {
      if (!s.category || s.confidence === "low") continue;
      const row = read.rows[s.ref];
      const categoryId = byName.get(s.category);
      if (!row || !categoryId) continue;
      // Only fill still-empty categories: never overwrite something a person set meanwhile.
      const r = await tx
        .update(t)
        .set({ categoryId, categorySource: "ai", reviewed: false })
        .where(and(eq(t.id, row.id), isNull(t.categoryId)))
        .returning({ id: t.id });
      n += r.length;
    }
    await recordAiUsage(tx, householdId, "categorize", usage);
    return n;
  });
  return { considered: read.rows.length, applied };
}

const dollars = (minor: number) => Math.round(minor) / 100;

/** Spending (positive minor units) per expense category for [start, end]. */
async function spendByCategory(tx: Tx, start: string, end: string) {
  const { rows } = await tx.execute<{ category: string; spent: string }>(sql`
    select coalesce(c.name, 'Uncategorized') as category, sum(-t.amount) as spent
    from transactions t
    left join categories c on c.id = t.category_id
    left join category_groups g on g.id = c.group_id
    where not t.excluded and not t.is_split and t.date between ${start}::date and ${end}::date
      and (g.kind = 'expense' or (g.kind is null and t.amount < 0))
    group by 1 having sum(-t.amount) > 0 order by 2 desc`);
  return rows.map((r) => ({ category: r.category, spent: Number(r.spent) }));
}

/** The 8 weeks before [weekStart, today]. Sequential: one transaction = one connection. */
async function priorWeeks(tx: Tx, weekStart: string, today: string) {
  const out: Awaited<ReturnType<typeof spendByCategory>>[] = [];
  for (let i = 1; i <= 8; i++)
    out.push(await spendByCategory(tx, addDays(weekStart, -7 * i), addDays(today, -7 * i)));
  return out;
}

export interface Findings {
  categories: ReturnType<typeof categoryAnomalies>;
  charges: ReturnType<typeof unusualCharges>;
  sentences: string[];
}

/** Last 7 days vs the 8 weeks before, plus unusually large single charges. */
export async function findAnomalies(tx: Tx, today = todayIso()): Promise<Findings> {
  const weekStart = addDays(today, -6);
  const current = await spendByCategory(tx, weekStart, today);
  const weeks = await priorWeeks(tx, weekStart, today);
  const history = new Map<string, number[]>();
  for (const w of weeks) {
    const m = new Map(w.map((x) => [x.category, x.spent]));
    for (const c of new Set([...current.map((x) => x.category), ...m.keys()])) {
      history.set(c, [...(history.get(c) ?? []), m.get(c) ?? 0]);
    }
  }
  const categories = categoryAnomalies(
    current,
    [...history].map(([category, spent]) => ({ category, spent })),
  );

  const { rows: recent } = await tx.execute<{
    id: string;
    merchant: string;
    amount: string;
    merchant_id: string;
  }>(sql`
    select t.id, m.name as merchant, -t.amount as amount, t.merchant_id
    from transactions t join merchants m on m.id = t.merchant_id
    where t.amount < 0 and not t.excluded and not t.is_split and t.date >= ${weekStart}::date`);
  const merchantIds = [...new Set(recent.map((r) => r.merchant_id))];
  const hist = merchantIds.length
    ? await tx
        .select({ merchantId: schema.transactions.merchantId, amount: schema.transactions.amount })
        .from(schema.transactions)
        .where(
          and(
            inArray(schema.transactions.merchantId, merchantIds),
            sql`${schema.transactions.date} < ${weekStart}::date`,
            sql`${schema.transactions.amount} < 0`,
          ),
        )
    : [];
  const byMerchant = new Map<string, number[]>();
  for (const h of hist)
    byMerchant.set(h.merchantId as string, [
      ...(byMerchant.get(h.merchantId as string) ?? []),
      -h.amount,
    ]);
  const charges = unusualCharges(
    recent.map((r) => ({
      id: r.id,
      merchant: r.merchant,
      amount: Number(r.amount),
      history: byMerchant.get(r.merchant_id) ?? [],
    })),
  );

  const fmt = (m: number) => `$${dollars(m).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const sentences = [
    ...categories
      .slice(0, 3)
      .map(
        (a) =>
          `${a.category} is ${Math.round((a.ratio - 1) * 100)}% above a typical week (${fmt(a.current)} vs ${fmt(a.typical)}).`,
      ),
    ...charges
      .slice(0, 3)
      .map(
        (c) =>
          `${c.merchant} charged ${fmt(c.amount)}, about ${Math.round(c.amount / c.typical)}× the usual ${fmt(c.typical)}.`,
      ),
  ];
  return { categories, charges, sentences };
}

/** Facts for the weekly digest: all computed here, so the model only writes prose. */
export async function buildWeeklyFacts(tx: Tx, today = todayIso()): Promise<DigestFacts> {
  const weekStart = addDays(today, -6);
  const current = await spendByCategory(tx, weekStart, today);
  const prior = await priorWeeks(tx, weekStart, today);
  const weekTotal = (rows: { spent: number }[]) => rows.reduce((t, r) => t + r.spent, 0);
  const { rows: inc } = await tx.execute<{ income: string | null }>(sql`
    select sum(t.amount) as income from transactions t
    join categories c on c.id = t.category_id join category_groups g on g.id = c.group_id
    where g.kind = 'income' and not t.excluded and t.date between ${weekStart}::date and ${today}::date`);
  const largest = await tx
    .select({
      merchant: schema.merchants.name,
      raw: schema.transactions.rawDescription,
      amount: schema.transactions.amount,
      date: schema.transactions.date,
    })
    .from(schema.transactions)
    .leftJoin(schema.merchants, eq(schema.merchants.id, schema.transactions.merchantId))
    .where(
      and(
        gte(schema.transactions.date, weekStart),
        sql`${schema.transactions.amount} < 0`,
        eq(schema.transactions.excluded, false),
        eq(schema.transactions.isSplit, false),
      ),
    )
    .orderBy(schema.transactions.amount)
    .limit(3);
  const bills = await tx
    .select({
      merchant: schema.merchants.name,
      amount: schema.recurringSeries.expectedAmount,
      date: schema.recurringSeries.nextDate,
    })
    .from(schema.recurringSeries)
    .innerJoin(schema.merchants, eq(schema.merchants.id, schema.recurringSeries.merchantId))
    .where(
      and(
        eq(schema.recurringSeries.status, "active"),
        eq(schema.recurringSeries.direction, "out"),
        gte(schema.recurringSeries.nextDate, today),
        sql`${schema.recurringSeries.nextDate} <= ${addDays(today, 7)}::date`,
      ),
    );
  const month = firstOfMonth(today);
  const { rows: budget } = await tx.execute<{
    budgeted: string | null;
    spent: string | null;
    over: string[] | null;
  }>(sql`
    with b as (
      select b.category_id, c.name, b.amount,
        coalesce((select sum(-t.amount) from transactions t where t.category_id = b.category_id and not t.excluded and not t.is_split
          and t.date >= ${month}::date and t.date <= ${today}::date), 0) as spent
      from budget_items b join categories c on c.id = b.category_id where b.month = ${month}::date)
    select sum(amount) as budgeted, sum(spent) as spent, array_agg(name) filter (where spent > amount) as over from b`);
  const findings = await findAnomalies(tx, today);

  return {
    weekStart,
    weekEnd: today,
    spent: dollars(weekTotal(current)),
    typicalWeeklySpend: dollars(prior.reduce((t, w) => t + weekTotal(w), 0) / prior.length),
    income: dollars(Number(inc[0]?.income ?? 0)),
    topCategories: current
      .slice(0, 5)
      .map((c) => ({ category: c.category, spent: dollars(c.spent) })),
    largestTransactions: largest.map((l) => ({
      merchant: l.merchant ?? l.raw,
      amount: dollars(-l.amount),
      date: l.date,
    })),
    anomalies: findings.sentences,
    upcomingBills: bills.map((b) => ({
      merchant: b.merchant,
      amount: dollars(-b.amount),
      date: b.date,
    })),
    budget: budget[0]?.budgeted
      ? {
          budgeted: dollars(Number(budget[0].budgeted)),
          spent: dollars(Number(budget[0].spent ?? 0)),
          overCategories: budget[0].over ?? [],
        }
      : null,
  };
}

/** Build facts, have the model write the digest, store it. Returns the stored digest. */
export async function generateWeeklyDigest(
  db: Db,
  householdId: string,
  ai: Ai,
  today = todayIso(),
): Promise<Digest & { periodStart: string }> {
  const facts = await withHousehold(db, householdId, async (tx) => {
    await assertAiBudget(tx, householdId);
    return buildWeeklyFacts(tx, today);
  });
  const { digest, usage } = await writeDigest(ai, facts);
  await withHousehold(db, householdId, async (tx) => {
    const body = {
      ...digest,
      anomalies: facts.anomalies,
      facts: { spent: facts.spent, typical: facts.typicalWeeklySpend },
    };
    await tx
      .insert(schema.insights)
      .values({
        householdId,
        kind: "weekly_digest",
        periodStart: facts.weekStart,
        title: digest.title,
        body,
      })
      .onConflictDoUpdate({
        target: [schema.insights.householdId, schema.insights.kind, schema.insights.periodStart],
        set: { title: digest.title, body },
      });
    await recordAiUsage(tx, householdId, "digest", usage);
  });
  return { ...digest, periodStart: facts.weekStart };
}
