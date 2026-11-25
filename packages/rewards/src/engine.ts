import type { RewardCategory } from "./categories";
import type { CapPeriod, Card, EarnRule } from "./schema";

/**
 * Points-earning engine. Pure: give it the household's wallet, the transactions on those
 * cards and a valuation, and it returns what each transaction earned, plus which card in
 * the wallet would have earned the most.
 *
 * Amounts are integer cents with the bank's sign: purchases are negative, refunds positive.
 * Refunds take back points at the rate the matching purchase would have earned.
 */

export interface EngineTransaction {
  id: string;
  accountId: string;
  date: string; // YYYY-MM-DD
  amount: number; // cents; negative = purchase
  /** Merchant name and raw bank description, matched against merchant-specific rules. */
  merchant: string;
  description: string;
  category: RewardCategory;
}

export interface WalletCard {
  id: string;
  accountId: string;
  card: Card;
  openedOn?: string | null;
  /** Rotating quarters the cardholder activated, e.g. ["2026-Q4"]. */
  activations?: readonly string[];
  /** Categories chosen for `user_choice` rules. */
  choices?: readonly RewardCategory[];
}

export interface Earned {
  transactionId: string;
  walletCardId: string;
  category: RewardCategory;
  /** The headline rate applied (points per dollar); blended when a cap was crossed. */
  multiplier: number;
  points: number;
  valueCents: number;
  /** The wallet card that would have earned the most for this transaction, and how much. */
  bestWalletCardId: string;
  bestValueCents: number;
}

/** Cents per point for a program slug. */
export type Valuation = (program: string) => number;

export const quarterOf = (date: string) =>
  `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;

/** Key of the cap period a date falls in, for one card. */
export function periodKey(period: CapPeriod, date: string, openedOn?: string | null): string {
  switch (period) {
    case "month":
      return date.slice(0, 7);
    case "quarter":
      return quarterOf(date);
    case "calendar_year":
      return date.slice(0, 4);
    case "cardmember_year": {
      if (!openedOn) return date.slice(0, 4);
      // Years since opening, counting the anniversary day as the start of a new year.
      let years = Number(date.slice(0, 4)) - Number(openedOn.slice(0, 4));
      if (date.slice(5) < openedOn.slice(5)) years -= 1;
      return `cm${years}`;
    }
  }
}

const text = (t: EngineTransaction) => `${t.merchant} ${t.description}`.toUpperCase();
const hits = (haystack: string, needles?: readonly string[]) =>
  !!needles?.some((n) => haystack.includes(n.toUpperCase()));

/** Per card, the eligible category with the most purchases in each period (for top_spend rules). */
function topSpendTable(wc: WalletCard, txns: readonly EngineTransaction[]) {
  const out = new Map<string, RewardCategory>();
  wc.card.earn.forEach((rule, i) => {
    if (rule.pick?.mode !== "top_spend") return;
    const period = rule.cap?.period ?? "month";
    const totals = new Map<string, Map<RewardCategory, number>>();
    for (const t of txns) {
      if (!rule.pick.eligible.includes(t.category)) continue;
      const key = periodKey(period, t.date, wc.openedOn);
      const m = totals.get(key) ?? new Map<RewardCategory, number>();
      m.set(t.category, (m.get(t.category) ?? 0) - t.amount);
      totals.set(key, m);
    }
    for (const [key, m] of totals) {
      const [top] = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      if (top && top[1] > 0) out.set(`${i}:${key}`, top[0]);
    }
  });
  return out;
}

function ruleMatches(
  rule: EarnRule,
  index: number,
  wc: WalletCard,
  t: EngineTransaction,
  top: Map<string, RewardCategory>,
): boolean {
  if (rule.validFrom && t.date < rule.validFrom) return false;
  if (rule.validTo && t.date > rule.validTo) return false;
  if (rule.channel === "portal" && t.category !== "portal_travel") return false;
  const tx = text(t);
  if (hits(tx, rule.excludeMerchants)) return false;
  if (rule.merchants?.length) return hits(tx, rule.merchants);
  if (rule.rotating) {
    const q = quarterOf(t.date);
    return !!wc.activations?.includes(q) && !!wc.card.rotating?.[q]?.includes(t.category);
  }
  if (rule.pick) {
    if (!rule.pick.eligible.includes(t.category)) return false;
    if (rule.pick.mode === "user_choice") return !!wc.choices?.includes(t.category);
    const key = periodKey(rule.cap?.period ?? "month", t.date, wc.openedOn);
    return top.get(`${index}:${key}`) === t.category;
  }
  return rule.categories.includes(t.category);
}

interface CardState {
  wc: WalletCard;
  top: Map<string, RewardCategory>;
  /** Cents spent so far per `${ruleIndex}:${periodKey}`. */
  capSpent: Map<string, number>;
}

/** Points for one transaction on one card; commits cap usage when `commit` is true. */
function earn(s: CardState, t: EngineTransaction, commit: boolean) {
  const { wc } = s;
  const base = wc.card.base;
  const cents = Math.abs(t.amount);
  const sign = t.amount < 0 ? 1 : -1;
  let best = { points: (cents / 100) * base, multiplier: base, capKey: "", capUsed: 0 };
  wc.card.earn.forEach((rule, i) => {
    if (!ruleMatches(rule, i, wc, t, s.top)) return;
    let points = (cents / 100) * rule.multiplier;
    let capKey = "";
    let capUsed = 0;
    if (rule.cap && sign > 0) {
      capKey = `${i}:${periodKey(rule.cap.period, t.date, wc.openedOn)}`;
      const left = Math.max(0, rule.cap.amount * 100 - (s.capSpent.get(capKey) ?? 0));
      capUsed = Math.min(cents, left);
      points =
        (capUsed / 100) * rule.multiplier + ((cents - capUsed) / 100) * (rule.afterCap ?? base);
    }
    if (points > best.points) best = { points, multiplier: rule.multiplier, capKey, capUsed };
  });
  if (commit && best.capKey) {
    s.capSpent.set(best.capKey, (s.capSpent.get(best.capKey) ?? 0) + best.capUsed);
  }
  const points = sign * Math.round(best.points);
  const multiplier =
    best.capKey && best.capUsed < cents
      ? Math.round((best.points / (cents / 100)) * 100) / 100
      : best.multiplier;
  return { points, multiplier };
}

/**
 * Compute earnings for every purchase or refund on a wallet card's account. Transactions on
 * accounts without a wallet card are ignored. The "best card" is chosen greedily in date
 * order, with each card's caps tracked separately for that hypothetical.
 */
export function computeRewards(input: {
  wallet: readonly WalletCard[];
  transactions: readonly EngineTransaction[];
  valuation: Valuation;
}): Earned[] {
  const byAccount = new Map(input.wallet.map((wc) => [wc.accountId, wc]));
  const txns = input.transactions
    .filter((t) => t.amount !== 0 && byAccount.has(t.accountId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const state = (wc: WalletCard): CardState => ({
    wc,
    top: topSpendTable(
      wc,
      txns.filter((t) => t.accountId === wc.accountId),
    ),
    capSpent: new Map(),
  });
  const actual = new Map(input.wallet.map((wc) => [wc.id, state(wc)]));
  // Hypothetical states: what each card would have earned had the best card always been used.
  const shadow = new Map(input.wallet.map((wc) => [wc.id, state(wc)]));
  const cents = (wc: WalletCard, points: number) =>
    Math.round(points * input.valuation(wc.card.program));

  const out: Earned[] = [];
  for (const t of txns) {
    const wc = byAccount.get(t.accountId) as WalletCard;
    const mine = earn(actual.get(wc.id) as CardState, t, true);
    const valueCents = cents(wc, mine.points);

    let bestId = wc.id;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (const other of input.wallet) {
      const v = cents(other, earn(shadow.get(other.id) as CardState, t, false).points);
      // Purchases: highest value wins. Refunds: compare by the purchase they reverse.
      const score = t.amount < 0 ? v : -v;
      if (score > bestValue || (score === bestValue && other.id === wc.id)) {
        bestValue = score;
        bestId = other.id;
      }
    }
    const best = input.wallet.find((w) => w.id === bestId) as WalletCard;
    const bestEarn = earn(shadow.get(bestId) as CardState, t, true);
    out.push({
      transactionId: t.id,
      walletCardId: wc.id,
      category: t.category,
      multiplier: mine.multiplier,
      points: mine.points,
      valueCents,
      bestWalletCardId: bestId,
      bestValueCents: cents(best, bestEarn.points),
    });
  }
  return out;
}

/** Suggest catalog cards for an account name, best match first (case- and punctuation-insensitive). */
export function suggestCards(accountName: string, cards: readonly Card[], limit = 3): Card[] {
  const norm = (s: string) =>
    ` ${s
      .toUpperCase()
      .replace(/[®™℠]/g, "")
      .replace(/[^A-Z0-9]+/g, " ")
      .trim()} `;
  const name = norm(accountName);
  const scored = cards.map((c) => {
    const names = [c.name, ...c.aliases].map(norm);
    let score = 0;
    for (const n of names) {
      if (name.includes(n)) score = Math.max(score, 100 + n.length);
      else {
        const words = n
          .trim()
          .split(" ")
          .filter((w) => w.length > 2);
        const hit = words.filter((w) => name.includes(` ${w} `)).length;
        if (words.length) score = Math.max(score, Math.round((hit / words.length) * 60) + hit);
      }
    }
    if (name.includes(norm(c.issuer).trim())) score += 5;
    return { c, score };
  });
  return scored
    .filter((s) => s.score >= 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.c);
}

export interface CapUsage {
  walletCardId: string;
  ruleIndex: number;
  rule: EarnRule;
  periodKey: string;
  spentCents: number;
  capCents: number;
}

/**
 * How much of each capped rate a card has used in the period containing `today`, counting
 * the card's own purchases in date order (the same accounting computeRewards uses).
 */
export function capUsage(
  wc: WalletCard,
  transactions: readonly EngineTransaction[],
  today: string,
): CapUsage[] {
  const txns = transactions
    .filter((t) => t.accountId === wc.accountId && t.amount !== 0 && t.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const s: CardState = { wc, top: topSpendTable(wc, txns), capSpent: new Map() };
  for (const t of txns) earn(s, t, true);
  return wc.card.earn.flatMap((rule, i) => {
    if (!rule.cap) return [];
    const key = periodKey(rule.cap.period, today, wc.openedOn);
    return [
      {
        walletCardId: wc.id,
        ruleIndex: i,
        rule,
        periodKey: key,
        spentCents: s.capSpent.get(`${i}:${key}`) ?? 0,
        capCents: Math.round(rule.cap.amount * 100),
      },
    ];
  });
}
