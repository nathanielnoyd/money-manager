import { schema, type Tx } from "@mm/db";
import {
  type Card,
  computeRewards,
  DEFAULT_CATEGORY_MAP,
  type Earned,
  type EngineTransaction,
  PORTAL_DESCRIPTORS,
  PROVIDER_CATEGORY_MAP,
  type Program,
  REWARD_CATEGORIES,
  type RewardCategory,
  type WalletCard,
} from "@mm/rewards";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { type HouseholdCatalog, householdCatalog, shipped } from "./catalog";

/**
 * Card rewards for a household, computed on read: wallet + transactions + the household's
 * catalog (shipped, plus its own edits) → what each purchase earned and which wallet card
 * would have earned the most. Nothing is stored, so edits show up immediately.
 */

const isRewardCategory = (s: string | null | undefined): s is RewardCategory =>
  !!s && s in REWARD_CATEGORIES;

export const RewardsSettings = z.object({
  valuation: z.enum(["typical", "floor"]).default("typical"),
  /** Custom cents per point by program slug; wins over `valuation`. */
  cpp: z.record(z.string(), z.number().min(0).max(10)).default({}),
  /** Agent and worker edits to the catalog wait for a person's approval. */
  requireCatalogApproval: z.boolean().default(false),
});
export type RewardsSettings = z.infer<typeof RewardsSettings>;

export function parseRewardsSettings(json: unknown): RewardsSettings {
  const r = RewardsSettings.safeParse(json ?? {});
  return r.success ? r.data : RewardsSettings.parse({});
}

export function centsPerPoint(
  settings: RewardsSettings,
  program: string,
  catalog: HouseholdCatalog,
): number {
  const custom = settings.cpp[program];
  if (custom !== undefined) return custom;
  const p = catalog.program(program);
  if (!p) return 1;
  return settings.valuation === "floor" ? p.floorCpp : p.typicalCpp;
}

export async function householdRewardsSettings(tx: Tx): Promise<RewardsSettings> {
  const [h] = await tx.select({ rewards: schema.households.rewards }).from(schema.households);
  return parseRewardsSettings(h?.rewards);
}

export const SignupBonus = z.object({
  points: z.number().int().positive().max(10_000_000),
  /** Dollars of spend required. */
  minSpend: z.number().positive().max(1_000_000),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** First day spend counts; defaults to the card's opening date. */
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type SignupBonus = z.infer<typeof SignupBonus>;

export interface WalletRow extends WalletCard {
  accountName: string;
  signupBonus: SignupBonus | null;
  /** Statement credits used per year, cents. */
  creditsValue: number;
  /** Null when the slug isn't in this release's catalog (shown as "unknown card"). */
  known: boolean;
}

export async function loadWallet(tx: Tx): Promise<WalletRow[]> {
  const catalog = await householdCatalog(tx);
  const rows = await tx
    .select({
      id: schema.walletCards.id,
      accountId: schema.walletCards.accountId,
      cardSlug: schema.walletCards.cardSlug,
      openedOn: schema.walletCards.openedOn,
      activations: schema.walletCards.activations,
      choices: schema.walletCards.choices,
      signupBonus: schema.walletCards.signupBonus,
      creditsValue: schema.walletCards.creditsValue,
      accountName: schema.accounts.name,
    })
    .from(schema.walletCards)
    .innerJoin(schema.accounts, sql`${schema.accounts.id} = ${schema.walletCards.accountId}`)
    .orderBy(schema.accounts.sortOrder, schema.accounts.name);
  return rows.flatMap((r) => {
    const card = catalog.card(r.cardSlug);
    if (!card) return [];
    return [
      {
        id: r.id,
        accountId: r.accountId,
        accountName: r.accountName,
        card,
        openedOn: r.openedOn,
        activations: r.activations,
        choices: r.choices.filter(isRewardCategory),
        signupBonus: SignupBonus.safeParse(r.signupBonus).data ?? null,
        creditsValue: r.creditsValue,
        known: true,
      },
    ];
  });
}

interface TxnRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  date: string;
  amount: string;
  raw_description: string;
  merchant: string | null;
  category_name: string | null;
  kind: "income" | "expense" | "transfer" | null;
  provider_category: string | null;
  tx_override: string | null;
  merchant_override: string | null;
  mapped: string | null;
}

export interface RewardLine extends Earned {
  date: string;
  amount: number;
  merchant: string;
  accountId: string;
}

/** Resolve a transaction's reward category: transaction → merchant → category map → provider → everything else. */
export function rewardCategoryFor(r: TxnRow, card: Card | undefined): RewardCategory {
  if (isRewardCategory(r.tx_override)) return r.tx_override;
  const text = `${r.merchant ?? ""} ${r.raw_description}`.toUpperCase();
  const portal = PORTAL_DESCRIPTORS.find((p) => p.patterns.some((x) => text.includes(x)));
  if (portal)
    return card?.issuer.toLowerCase().includes(portal.issuer) ? "portal_travel" : "travel";
  if (isRewardCategory(r.merchant_override)) return r.merchant_override;
  if (isRewardCategory(r.mapped)) return r.mapped;
  const byName = r.category_name ? DEFAULT_CATEGORY_MAP[r.category_name] : undefined;
  if (byName) return byName;
  const provider = r.provider_category ? PROVIDER_CATEGORY_MAP[r.provider_category] : undefined;
  return provider ?? "everything_else";
}

/**
 * Card purchases between two dates as engine transactions, with reward categories resolved.
 * `scope: "wallet"` loads only accounts linked to a wallet card; "credit" loads every credit
 * card account (for simulating cards the household doesn't have yet).
 */
export async function loadCardSpend(
  tx: Tx,
  range: { start: string; end: string },
  wallet: readonly WalletRow[],
  scope: "wallet" | "credit" = "wallet",
): Promise<EngineTransaction[]> {
  const { rows } = await tx.execute<TxnRow>(sql`
    select t.id, t.account_id, t.date::text as date, t.amount, t.raw_description, m.name as merchant,
      c.name as category_name, g.kind, t.provider_category,
      o.reward_category as tx_override, mr.reward_category as merchant_override, rm.reward_category as mapped
    from transactions t
    ${scope === "wallet" ? sql`join wallet_cards w on w.account_id = t.account_id` : sql`join accounts a on a.id = t.account_id and a.type = 'credit'`}
    left join merchants m on m.id = t.merchant_id
    left join categories c on c.id = t.category_id
    left join category_groups g on g.id = c.group_id
    left join transaction_reward_overrides o on o.transaction_id = t.id
    left join merchant_reward_categories mr on mr.merchant_id = t.merchant_id
    left join reward_category_map rm on rm.category_id = t.category_id
    where t.date between ${range.start}::date and ${range.end}::date
      and not t.excluded and not t.is_split and not t.pending
      and coalesce(g.kind::text, '') not in ('transfer', 'income')
      and (t.category_id is not null or t.amount < 0)`);
  const cardFor = new Map(wallet.map((w) => [w.accountId, w.card]));
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    date: r.date,
    amount: Number(r.amount),
    merchant: r.merchant ?? "",
    description: r.raw_description,
    category: rewardCategoryFor(r, cardFor.get(r.account_id)),
  }));
}

/**
 * What every purchase on a wallet card earned between `start` and `end`. History from the
 * previous calendar year is included in the computation so caps are counted correctly.
 */
export async function computeHouseholdRewards(
  tx: Tx,
  range: { start: string; end: string },
): Promise<{
  wallet: WalletRow[];
  lines: RewardLine[];
  settings: RewardsSettings;
  catalog: HouseholdCatalog;
}> {
  const [wallet, settings, catalog] = await Promise.all([
    loadWallet(tx),
    householdRewardsSettings(tx),
    householdCatalog(tx),
  ]);
  if (!wallet.length) return { wallet, lines: [], settings, catalog };
  const from = `${Number(range.start.slice(0, 4)) - 1}-01-01`;
  const txns = await loadCardSpend(tx, { start: from, end: range.end }, wallet);
  const byId = new Map(txns.map((t) => [t.id, t]));
  const earned = computeRewards({
    wallet,
    transactions: txns,
    valuation: (program) => centsPerPoint(settings, program, catalog),
  });
  const lines = earned.flatMap((e) => {
    const t = byId.get(e.transactionId) as EngineTransaction;
    if (t.date < range.start) return [];
    return [
      {
        ...e,
        date: t.date,
        amount: t.amount,
        merchant: t.merchant || t.description,
        accountId: t.accountId,
      },
    ];
  });
  return { wallet, lines, settings, catalog };
}

const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s/-])(\w)/g, (_m, a: string, b: string) => a + b.toUpperCase());

/** A short human summary of a card's rates, best first: "4x dining · 4x groceries (to $25k/yr) · 1x else". */
export function rateSummary(card: Card): string {
  const period = {
    month: "mo",
    quarter: "qtr",
    calendar_year: "yr",
    cardmember_year: "yr",
  } as const;
  const rate = (m: number) => (card.program === "cash_back" ? `${m}%` : `${m}x`);
  const parts = [...card.earn]
    .sort((a, b) => b.multiplier - a.multiplier)
    .map((r) => {
      const what = r.rotating
        ? "rotating categories"
        : r.pick
          ? r.pick.mode === "user_choice"
            ? `your choice of ${r.pick.eligible.join(" or ").replaceAll("_", " ")}`
            : `top category of ${r.pick.eligible.length}`
          : r.merchants?.length
            ? `at ${titleCase(r.merchants[0] ?? "")}`
            : r.categories.map((c) => REWARD_CATEGORIES[c].label.toLowerCase()).join(", ");
      const cap = r.cap
        ? ` (to $${r.cap.amount.toLocaleString("en-US")}/${period[r.cap.period]})`
        : "";
      return `${rate(r.multiplier)} ${what}${cap}`;
    });
  return [...parts, `${rate(card.base)} everything else`].join(" · ");
}

export const programName = (slug: string): string => shipped.program(slug)?.name ?? slug;
export type { Program };
