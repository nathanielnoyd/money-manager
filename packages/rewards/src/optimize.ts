import { computeRewards, type EngineTransaction, type Valuation, type WalletCard } from "./engine";
import type { Card } from "./schema";

/**
 * Wallet-level questions answered by replaying spending through the engine:
 * what a set of cards could earn at best, what one card adds, and what a new card would add.
 * All values are cents over the transactions given; callers annualize.
 */

/** Best total value if every purchase went on the best card of `cards` (greedy, caps tracked per card). */
export function bestTotal(
  cards: readonly Pick<WalletCard, "id" | "card" | "openedOn" | "activations" | "choices">[],
  transactions: readonly EngineTransaction[],
  valuation: Valuation,
): number {
  if (!cards.length || !transactions.length) return 0;
  // Give every card its own synthetic account and put all spend on the first one; the
  // engine's best-card pass then considers every card for every purchase.
  const wallet: WalletCard[] = cards.map((c, i) => ({ ...c, accountId: `sim:${i}` }));
  const txns = transactions.map((t) => ({ ...t, accountId: "sim:0" }));
  return computeRewards({ wallet, transactions: txns, valuation }).reduce(
    (s, e) => s + e.bestValueCents,
    0,
  );
}

/** What each wallet card adds: best value with the whole wallet minus best value without that card. */
export function marginalValues(
  wallet: readonly WalletCard[],
  transactions: readonly EngineTransaction[],
  valuation: Valuation,
): Map<string, number> {
  const all = bestTotal(wallet, transactions, valuation);
  return new Map(
    wallet.map((w) => [
      w.id,
      all -
        bestTotal(
          wallet.filter((x) => x.id !== w.id),
          transactions,
          valuation,
        ),
    ]),
  );
}

export interface CandidateResult {
  card: Card;
  /** Extra value over the period from adding the card (before its annual fee). */
  gainCents: number;
}

/** For each candidate card, the extra value adding it to the wallet would have produced. */
export function simulateCandidates(
  wallet: readonly WalletCard[],
  candidates: readonly Card[],
  transactions: readonly EngineTransaction[],
  valuation: Valuation,
): CandidateResult[] {
  const base = bestTotal(wallet, transactions, valuation);
  return candidates.map((card) => ({
    card,
    gainCents:
      bestTotal([...wallet, { id: `candidate:${card.slug}`, card }], transactions, valuation) -
      base,
  }));
}

/** Scale a value over `days` of history to a year; short histories are capped at 4x. */
export function annualize(cents: number, days: number): number {
  if (days <= 0) return 0;
  return Math.round(cents * Math.min(4, 365 / days));
}
