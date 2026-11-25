import { minorToDecimal, toCsv } from "@mm/core";
import { schema, type Tx } from "@mm/db";
import { asc, eq, sql } from "drizzle-orm";

/**
 * Everything a household owns, for moving to another tool or keeping a readable copy.
 * Not an operation on purpose: export is an owner-only, step-up action in the app and is
 * never reachable through an agent token (AGENTS.md, invariant 8).
 *
 * Left out: credentials and anything derived from them (sealed bank tokens, sync cursors,
 * agent tokens, invites, sessions), members' identities, and operational logs.
 */

export const EXPORT_FORMAT_VERSION = 1;

const dropHousehold = <T extends Record<string, unknown>>(rows: T[]) =>
  rows.map(({ householdId: _householdId, ...rest }) => rest);

/** The whole household as one JSON-serializable object. Money is integer minor units (cents). */
export async function exportHousehold(tx: Tx, householdId: string) {
  const [household] = await tx
    .select({
      name: schema.households.name,
      currency: schema.households.currency,
      budgetMode: schema.households.budgetMode,
      rewards: schema.households.rewards,
      createdAt: schema.households.createdAt,
    })
    .from(schema.households)
    .where(eq(schema.households.id, householdId));
  // Reads run one after another: a transaction is a single connection.
  const all = async <T extends Record<string, unknown>>(q: Promise<T[]>) => dropHousehold(await q);
  return {
    format: "money-manager-export",
    version: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    notes: {
      money:
        "Amounts and balances are integers in minor units (cents). Transaction amounts are signed: negative is money out.",
      liabilities: "Balances of credit and loan accounts are stored as the positive amount owed.",
      excluded:
        "Bank credentials, agent tokens, invites, sessions, members and logs are not exported.",
    },
    household,
    connections: await tx
      .select({
        id: schema.connections.id,
        provider: schema.connections.provider,
        institutionName: schema.connections.institutionName,
        status: schema.connections.status,
        lastSyncedAt: schema.connections.lastSyncedAt,
      })
      .from(schema.connections),
    accounts: await all(tx.select().from(schema.accounts).orderBy(asc(schema.accounts.sortOrder))),
    balanceSnapshots: await all(
      tx
        .select()
        .from(schema.balanceSnapshots)
        .orderBy(asc(schema.balanceSnapshots.accountId), asc(schema.balanceSnapshots.date)),
    ),
    categoryGroups: await all(tx.select().from(schema.categoryGroups)),
    categories: await all(tx.select().from(schema.categories)),
    merchants: await all(tx.select().from(schema.merchants)),
    tags: await all(tx.select().from(schema.tags)),
    transactions: await all(
      tx
        .select()
        .from(schema.transactions)
        .orderBy(asc(schema.transactions.date), asc(schema.transactions.id)),
    ),
    transactionTags: await all(tx.select().from(schema.transactionTags)),
    imports: await all(tx.select().from(schema.imports)),
    rules: await all(tx.select().from(schema.rules)),
    budgetItems: await all(tx.select().from(schema.budgetItems)),
    recurringSeries: await all(tx.select().from(schema.recurringSeries)),
    goals: await all(tx.select().from(schema.goals)),
    securities: await all(tx.select().from(schema.securities)),
    holdings: await all(tx.select().from(schema.holdings)),
    insights: await all(tx.select().from(schema.insights)),
    walletCards: await all(tx.select().from(schema.walletCards)),
    rewardCategoryMap: await all(tx.select().from(schema.rewardCategoryMap)),
    merchantRewardCategories: await all(tx.select().from(schema.merchantRewardCategories)),
    transactionRewardOverrides: await all(tx.select().from(schema.transactionRewardOverrides)),
    pointsBalances: await all(tx.select().from(schema.pointsBalances)),
    catalogOverrides: await all(tx.select().from(schema.catalogOverrides)),
  };
}

export type HouseholdExport = Awaited<ReturnType<typeof exportHousehold>>;

const HEADER = [
  "Date",
  "Account",
  "Description",
  "Merchant",
  "Category",
  "Category group",
  "Amount",
  "Currency",
  "Pending",
  "Excluded",
  "Reviewed",
  "Split of",
  "Notes",
  "Id",
];

/**
 * Every transaction as CSV, one row each, newest first. A split transaction is written as its
 * parts (with the original's id under "Split of"), so the amounts add up to what was spent.
 */
export async function exportTransactionsCsv(tx: Tx): Promise<string> {
  const { rows } = await tx.execute<{
    date: string;
    account: string;
    description: string;
    merchant: string | null;
    category: string | null;
    grp: string | null;
    amount: string;
    currency: string;
    pending: boolean;
    excluded: boolean;
    reviewed: boolean;
    split_parent_id: string | null;
    notes: string | null;
    id: string;
  }>(sql`
    select t.date::text as date, a.name as account, t.raw_description as description,
      m.name as merchant, c.name as category, g.name as grp, t.amount, t.currency,
      t.pending, t.excluded, t.reviewed, t.split_parent_id, t.notes, t.id
    from transactions t
    join accounts a on a.id = t.account_id
    left join merchants m on m.id = t.merchant_id
    left join categories c on c.id = t.category_id
    left join category_groups g on g.id = c.group_id
    where not t.is_split
    order by t.date desc, t.id desc`);
  return toCsv(
    [
      HEADER,
      ...rows.map((r) => [
        r.date,
        r.account,
        r.description,
        r.merchant,
        r.category,
        r.grp,
        minorToDecimal(Number(r.amount)),
        r.currency,
        r.pending ? "yes" : "no",
        r.excluded ? "yes" : "no",
        r.reviewed ? "yes" : "no",
        r.split_parent_id,
        r.notes,
        r.id,
      ]),
    ],
    [HEADER.indexOf("Amount")],
  );
}
