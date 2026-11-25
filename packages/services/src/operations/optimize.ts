import { addDays, todayIso } from "@mm/core";
import { schema, type Tx } from "@mm/db";
import {
  annualize,
  computeRewards,
  type EngineTransaction,
  marginalValues,
  nextAnniversary,
  REWARD_CATEGORIES,
  REWARD_CATEGORY_IDS,
  type RewardCategory,
  simulateCandidates,
} from "@mm/rewards";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { householdCatalog, shipped } from "../catalog";
import { defineOperation, OperationError } from "../operation";
import {
  centsPerPoint,
  computeHouseholdRewards,
  householdRewardsSettings,
  loadCardSpend,
  loadWallet,
  programName,
  rateSummary,
  SignupBonus,
  type WalletRow,
} from "../rewards";
import { cents, DateStr, Dollars, dollars } from "../util";

/**
 * Card optimization: which card to use, what was left on the table, whether each card
 * pays for its fee, and which new card would pay off. Values are dollars.
 */

const read = { minRole: "viewer", scope: "read", readOnly: true, idempotent: true } as const;
const write = {
  minRole: "member",
  scope: "rewards:write",
  readOnly: false,
  idempotent: true,
} as const;

const label = (c: RewardCategory) => REWARD_CATEGORIES[c].label;
type Valuer = (program: string) => number;

/** Cents per point for each program, at the household's settings and catalog. */
async function valuer(tx: Tx): Promise<Valuer> {
  const [s, catalog] = await Promise.all([householdRewardsSettings(tx), householdCatalog(tx)]);
  return (program) => centsPerPoint(s, program, catalog);
}

/** The last 365 days of card spend, and how many days of it there really are. */
async function lastYear(tx: Tx, wallet: readonly WalletRow[], scope: "wallet" | "credit") {
  const today = todayIso();
  const start = addDays(today, -364);
  const txns = await loadCardSpend(tx, { start, end: today }, wallet, scope);
  const first = txns.map((t) => t.date).sort()[0] ?? today;
  const days = Math.max(1, Math.round((Date.parse(today) - Date.parse(first)) / 86_400_000) + 1);
  return { today, start, txns, days };
}

/** Value of one hypothetical purchase on a card (no caps used yet). */
function oneOff(w: WalletRow, category: RewardCategory, value: Valuer, date: string) {
  const [e] = computeRewards({
    wallet: [w],
    valuation: value,
    transactions: [
      {
        id: "x",
        accountId: w.accountId,
        date,
        amount: -10_000,
        merchant: "",
        description: "",
        category,
      },
    ],
  });
  return { multiplier: e?.multiplier ?? 0, valueCents: e?.valueCents ?? 0 };
}

// ───────────────────────────── Reads ─────────────────────────────

export const getCheatSheet = defineOperation({
  ...read,
  name: "get_card_cheat_sheet",
  title: "Which card to use",
  description:
    "For each reward category, the wallet card that earns the most (and the runner-up), with its rate and value per $100 at the household's point values. Ignores caps already used; check get_wallet for rotating-category activation.",
  input: z.object({}),
  async run(tx) {
    const [wallet, value] = await Promise.all([loadWallet(tx), valuer(tx)]);
    if (!wallet.length) return { categories: [] };
    const today = todayIso();
    return {
      categories: REWARD_CATEGORY_IDS.map((category) => {
        const ranked = wallet
          .map((w) => ({ w, ...oneOff(w, category, value, today) }))
          .sort((a, b) => b.valueCents - a.valueCents);
        const [best, next] = ranked;
        const unit = (w: WalletRow, m: number) =>
          w.card.program === "cash_back" ? `${m}%` : `${m}x`;
        return {
          category,
          label: label(category),
          card: best?.w.card.name,
          walletCardId: best?.w.id,
          rate: best ? unit(best.w, best.multiplier) : null,
          valuePer100: dollars(best?.valueCents ?? 0),
          ...(next && next.valueCents > 0
            ? { runnerUp: next.w.card.name, runnerUpValuePer100: dollars(next.valueCents) }
            : {}),
        };
      }),
    };
  },
});

export const getMissedValue = defineOperation({
  ...read,
  name: "get_missed_value",
  title: "Rewards left on the table",
  description:
    "Between two dates: what wallet card purchases earned vs. what the best wallet card would have earned, by reward category (with the card that should have been used), the biggest individual misses, and the top suggestions. Dollars.",
  input: z.object({ start: DateStr, end: DateStr }),
  async run(tx, _p, range) {
    const { wallet, lines } = await computeHouseholdRewards(tx, range);
    const name = new Map(wallet.map((w) => [w.id, w.card.name]));
    const cats = new Map<
      RewardCategory,
      { earned: number; best: number; bestCard: Map<string, number> }
    >();
    for (const l of lines) {
      const c = cats.get(l.category) ?? { earned: 0, best: 0, bestCard: new Map() };
      const best = Math.max(l.bestValueCents, l.valueCents);
      c.earned += l.valueCents;
      c.best += best;
      if (best > l.valueCents)
        c.bestCard.set(
          l.bestWalletCardId,
          (c.bestCard.get(l.bestWalletCardId) ?? 0) + best - l.valueCents,
        );
      cats.set(l.category, c);
    }
    const byCategory = [...cats.entries()]
      .map(([category, c]) => {
        const [top] = [...c.bestCard.entries()].sort((a, b) => b[1] - a[1]);
        return {
          category,
          label: label(category),
          earned: dollars(c.earned),
          bestPossible: dollars(c.best),
          missed: dollars(c.best - c.earned),
          ...(top ? { useCard: name.get(top[0]) } : {}),
        };
      })
      .filter((c) => c.missed > 0)
      .sort((a, b) => b.missed - a.missed);
    const earned = lines.reduce((s, l) => s + l.valueCents, 0);
    const best = lines.reduce((s, l) => s + Math.max(l.bestValueCents, l.valueCents), 0);
    return {
      start: range.start,
      end: range.end,
      earned: dollars(earned),
      bestPossible: dollars(best),
      missed: dollars(best - earned),
      byCategory,
      suggestions: byCategory
        .slice(0, 3)
        .map(
          (c) =>
            `Use ${c.useCard} for ${c.label.toLowerCase()}: ${c.missed.toLocaleString("en-US", { style: "currency", currency: "USD" })} more over this period.`,
        ),
      biggestMisses: lines
        .map((l) => ({ l, miss: l.bestValueCents - l.valueCents }))
        .filter((x) => x.miss > 0)
        .sort((a, b) => b.miss - a.miss)
        .slice(0, 10)
        .map(({ l, miss }) => ({
          transactionId: l.transactionId,
          date: l.date,
          merchant: l.merchant,
          amount: dollars(l.amount),
          usedCard: name.get(l.walletCardId),
          bestCard: name.get(l.bestWalletCardId),
          missed: dollars(miss),
        })),
    };
  },
});

export const getCardValues = defineOperation({
  ...read,
  name: "get_card_values",
  title: "Is each card worth its fee?",
  description:
    "For each wallet card, over the last 12 months (annualized if there's less history): what it earned, what it adds beyond the rest of the wallet, the statement credits the household says it uses, its annual fee, the net, and the next fee date. A negative net means the wallet would do as well or better without it.",
  input: z.object({}),
  async run(tx) {
    const [wallet, value] = await Promise.all([loadWallet(tx), valuer(tx)]);
    if (!wallet.length) return { historyDays: 0, cards: [] };
    const { today, start, txns, days } = await lastYear(tx, wallet, "wallet");
    const { lines } = await computeHouseholdRewards(tx, { start, end: today });
    const marginal = marginalValues(wallet, txns, value);
    return {
      historyDays: Math.min(days, 365),
      cards: wallet.map((w) => {
        const earned = annualize(
          lines.filter((l) => l.walletCardId === w.id).reduce((s, l) => s + l.valueCents, 0),
          days,
        );
        const adds = annualize(marginal.get(w.id) ?? 0, days);
        const fee = Math.round(w.card.annualFee * 100);
        const net = adds + w.creditsValue - fee;
        return {
          walletCardId: w.id,
          accountId: w.accountId,
          card: w.card.name,
          account: w.accountName,
          earnedPerYear: dollars(earned),
          addsPerYear: dollars(adds),
          creditsUsedPerYear: dollars(w.creditsValue),
          annualFee: w.card.annualFee,
          netPerYear: dollars(net),
          verdict: fee === 0 ? "no fee" : net >= 0 ? "worth it" : "review",
          ...(w.openedOn ? { nextFeeDate: nextAnniversary(w.openedOn, today) } : {}),
        };
      }),
    };
  },
});

const Recommend = z.object({
  limit: z.number().int().min(1).max(20).default(5),
  includeBusiness: z.boolean().default(false),
  maxAnnualFee: z.number().min(0).max(10_000).optional().describe("Dollars"),
});

async function rankCandidates(tx: Tx, input: z.output<typeof Recommend> & { only?: string }) {
  const [wallet, value, catalog] = await Promise.all([
    loadWallet(tx),
    valuer(tx),
    householdCatalog(tx),
  ]);
  const { txns, days } = await lastYear(tx, wallet, "credit");
  const owned = new Set(wallet.map((w) => w.card.slug));
  const candidates = catalog.cards.filter(
    (c) =>
      (input.only ? c.slug === input.only : !owned.has(c.slug)) &&
      (input.includeBusiness || !c.business || input.only) &&
      (input.maxAnnualFee === undefined || c.annualFee <= input.maxAnnualFee),
  );
  const results = simulateCandidates(wallet, candidates, txns, value).map((r) => {
    const gain = annualize(r.gainCents, days);
    const fee = Math.round(r.card.annualFee * 100);
    return {
      slug: r.card.slug,
      card: r.card.name,
      issuer: r.card.issuer,
      program: programName(r.card.program),
      rates: rateSummary(r.card),
      annualFee: r.card.annualFee,
      extraRewardsPerYear: dollars(gain),
      netPerYear: dollars(gain - fee),
      ...(r.card.business ? { business: true } : {}),
    };
  });
  return { wallet, txns, days, results, value, catalog };
}

export const recommendCards = defineOperation({
  ...read,
  name: "recommend_cards",
  title: "Cards that would pay off",
  description:
    "Replays the last 12 months of credit card spending through every catalog card not already in the wallet and ranks them by extra rewards per year minus the annual fee, at the household's point values. Sign-up bonuses, statement credits and first-year fee waivers are not included. This is arithmetic on the household's own data, not financial advice.",
  input: Recommend,
  async run(tx, _p, input) {
    const { results, days, wallet } = await rankCandidates(tx, input);
    return {
      basedOnDays: Math.min(days, 365),
      wallet: wallet.map((w) => w.card.name),
      cards: results.sort((a, b) => b.netPerYear - a.netPerYear).slice(0, input.limit),
      note: "Excludes sign-up bonuses, statement credits and approval odds.",
    };
  },
});

export const simulateCard = defineOperation({
  ...read,
  name: "simulate_card",
  title: "What would this card add?",
  description:
    "Replays the last 12 months of credit card spending with one catalog card added to the wallet: extra rewards per year, net of its annual fee, and which reward categories it would win. Slug from search_card_catalog.",
  input: z.object({ slug: z.string().max(80) }),
  async run(tx, _p, { slug }) {
    const { results, txns, days, wallet, value, catalog } = await rankCandidates(tx, {
      limit: 1,
      includeBusiness: true,
      only: slug,
    });
    const [r] = results;
    if (!r) throw new OperationError("not_found", `No card "${slug}" in the catalog.`);
    const card = catalog.card(slug);
    // Which categories it would take over: compare per-category best with and without it.
    const byCat = new Map<RewardCategory, EngineTransaction[]>();
    for (const t of txns) byCat.set(t.category, [...(byCat.get(t.category) ?? []), t]);
    const wins = card
      ? [...byCat.entries()]
          .map(([category, ts]) => {
            const [g] = simulateCandidates(wallet, [card], ts, value);
            return {
              category,
              label: label(category),
              extraPerYear: dollars(annualize(g?.gainCents ?? 0, days)),
            };
          })
          .filter((x) => x.extraPerYear > 0)
          .sort((a, b) => b.extraPerYear - a.extraPerYear)
      : [];
    return { ...r, basedOnDays: Math.min(days, 365), categoriesItWouldWin: wins };
  },
});

export const listPointsBalances = defineOperation({
  ...read,
  name: "list_points_balances",
  title: "Points balances",
  description:
    "Points and miles balances the household has recorded, valued at its cents-per-point, with the total. Balances are entered by a person or an agent; banks don't report them.",
  input: z.object({}),
  async run(tx) {
    const value = await valuer(tx);
    const rows = await tx.select().from(schema.pointsBalances);
    const balances = rows
      .map((r) => {
        const cpp = value(r.programSlug);
        return {
          program: programName(r.programSlug),
          slug: r.programSlug,
          balance: r.balance,
          asOf: r.asOf,
          centsPerPoint: cpp,
          value: dollars(Math.round(r.balance * cpp)),
        };
      })
      .sort((a, b) => b.value - a.value);
    return { total: Math.round(balances.reduce((s, b) => s + b.value, 0) * 100) / 100, balances };
  },
});

export const getSignupBonusProgress = defineOperation({
  ...read,
  name: "get_signup_bonus_progress",
  title: "Sign-up bonus progress",
  description:
    "For each wallet card with a sign-up bonus recorded: spend so far toward the minimum, what's left, days left, and the daily spend needed to make it.",
  input: z.object({}),
  async run(tx) {
    const wallet = (await loadWallet(tx)).filter((w) => w.signupBonus);
    if (!wallet.length) return { bonuses: [] };
    const today = todayIso();
    const earliest = wallet
      .map(
        (w) =>
          w.signupBonus?.startDate ??
          w.openedOn ??
          addDays(w.signupBonus?.deadline as string, -120),
      )
      .sort()[0] as string;
    const txns = await loadCardSpend(tx, { start: earliest, end: today }, wallet);
    return {
      bonuses: wallet.map((w) => {
        const { spentCents: _, ...r } = bonusProgress(w, txns, today);
        return r;
      }),
    };
  },
});

export function bonusProgress(w: WalletRow, txns: readonly EngineTransaction[], today: string) {
  const b = w.signupBonus as SignupBonus;
  const from = b.startDate ?? w.openedOn ?? addDays(b.deadline, -120);
  const until = today < b.deadline ? today : b.deadline;
  const spentCents = -txns
    .filter((t) => t.accountId === w.accountId && t.date >= from && t.date <= until)
    .reduce((s, t) => s + t.amount, 0);
  const remaining = Math.max(0, Math.round(b.minSpend * 100) - spentCents);
  const daysLeft = Math.round((Date.parse(b.deadline) - Date.parse(today)) / 86_400_000);
  return {
    walletCardId: w.id,
    accountId: w.accountId,
    card: w.card.name,
    points: b.points,
    minSpend: b.minSpend,
    deadline: b.deadline,
    spent: dollars(spentCents),
    remaining: dollars(remaining),
    daysLeft,
    status: remaining === 0 ? "met" : daysLeft < 0 ? "missed" : "in progress",
    ...(remaining > 0 && daysLeft > 0
      ? { neededPerDay: dollars(Math.ceil(remaining / daysLeft)) }
      : {}),
    spentCents,
  };
}

// ───────────────────────────── Writes ─────────────────────────────

async function walletCardFor(tx: Tx, accountId: string) {
  const [w] = await tx
    .select({ id: schema.walletCards.id })
    .from(schema.walletCards)
    .where(eq(schema.walletCards.accountId, accountId));
  if (!w)
    throw new OperationError("not_found", "Link that account to a card first (set_wallet_card).");
  return w.id;
}

export const setPointsBalance = defineOperation({
  ...write,
  name: "set_points_balance",
  title: "Record a points balance",
  description:
    "Record the current balance of a points or miles program (slug from list_reward_programs). Pass balance null to remove it.",
  input: z.object({
    program: z.string().max(40),
    balance: z.number().int().min(0).max(1_000_000_000).nullable(),
    asOf: DateStr.optional(),
  }),
  async run(tx, p, i) {
    if (!shipped.program(i.program) || i.program === "cash_back")
      throw new OperationError("not_found", `No points program "${i.program}".`);
    const where = and(
      eq(schema.pointsBalances.householdId, p.householdId),
      eq(schema.pointsBalances.programSlug, i.program),
    );
    if (i.balance === null) {
      await tx.delete(schema.pointsBalances).where(where);
      return { program: i.program, balance: null };
    }
    const asOf = i.asOf ?? todayIso();
    await tx
      .insert(schema.pointsBalances)
      .values({ householdId: p.householdId, programSlug: i.program, balance: i.balance, asOf })
      .onConflictDoUpdate({
        target: [schema.pointsBalances.householdId, schema.pointsBalances.programSlug],
        set: { balance: i.balance, asOf },
      });
    return { program: i.program, balance: i.balance, asOf };
  },
});

export const setSignupBonus = defineOperation({
  ...write,
  name: "set_signup_bonus",
  title: "Track a sign-up bonus",
  description:
    "Record the sign-up bonus for a wallet card (account id from get_wallet): bonus points, minimum spend in dollars, deadline, and optionally when spending started counting (defaults to the card's opening date, or today if that isn't set). Pass bonus null to stop tracking.",
  input: z.object({ accountId: z.uuid(), bonus: SignupBonus.nullable() }),
  async run(tx, _p, { accountId, bonus }) {
    const id = await walletCardFor(tx, accountId);
    const [w] = await tx
      .select({ openedOn: schema.walletCards.openedOn })
      .from(schema.walletCards)
      .where(eq(schema.walletCards.id, id));
    // Without an opening date or explicit start, count spend from the day tracking starts.
    const stored =
      bonus && !bonus.startDate && !w?.openedOn ? { ...bonus, startDate: todayIso() } : bonus;
    await tx
      .update(schema.walletCards)
      .set({ signupBonus: stored })
      .where(eq(schema.walletCards.id, id));
    return { accountId, bonus: stored };
  },
});

export const setCardCredits = defineOperation({
  ...write,
  name: "set_card_credits",
  title: "Record the credits a card's perks are worth to you",
  description:
    "How much of a wallet card's statement credits and perks the household actually uses per year, in dollars. Counted against the annual fee in get_card_values.",
  input: z.object({ accountId: z.uuid(), creditsPerYear: Dollars.max(10_000) }),
  async run(tx, _p, { accountId, creditsPerYear }) {
    const id = await walletCardFor(tx, accountId);
    await tx
      .update(schema.walletCards)
      .set({ creditsValue: cents(creditsPerYear) })
      .where(eq(schema.walletCards.id, id));
    return { accountId, creditsPerYear };
  },
});

export const OPTIMIZE_OPERATIONS = [
  getCheatSheet,
  getMissedValue,
  getCardValues,
  recommendCards,
  simulateCard,
  listPointsBalances,
  getSignupBonusProgress,
  setPointsBalance,
  setSignupBonus,
  setCardCredits,
] as const;
