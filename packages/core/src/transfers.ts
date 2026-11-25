import { type AccountType, isLiability } from "./accounts";
import { daysBetween } from "./dates";

/**
 * Spot moves between a household's own accounts: the same amount leaving one account and
 * arriving in another within a few days. Left alone, a card payment or a move to savings
 * counts once as spending and once as income.
 *
 * Deliberately conservative, because a wrong match hides real spending:
 * - the amounts must be exact opposites, in different accounts, at most `maxDays` apart;
 * - the pairing must be unambiguous (one possible partner on each side);
 * - it must look like a transfer: money arriving in a credit card or loan from another kind
 *   of account (a payment), or a description on either side that says transfer or payment.
 */

export interface TransferCandidate {
  id: string;
  accountId: string;
  accountType: AccountType;
  /** YYYY-MM-DD */
  date: string;
  /** Signed minor units: negative is money out of the account. */
  amount: number;
  description: string;
  /** Only pairs with at least one new row are returned, so old history isn't rewritten. */
  fresh: boolean;
}

export interface TransferPair {
  outId: string;
  inId: string;
  /** True when the money arrived in a credit card or loan account. */
  cardPayment: boolean;
}

const TRANSFER_WORDS = /\b(transfer|xfer|trnsfr|tfr|autopay|payment|pymt|pmt)\b/i;

export function matchTransfers(rows: TransferCandidate[], maxDays = 3): TransferPair[] {
  const byAmount = new Map<number, { out: TransferCandidate[]; in: TransferCandidate[] }>();
  for (const r of rows) {
    if (r.amount === 0) continue;
    const key = Math.abs(r.amount);
    const g = byAmount.get(key) ?? { out: [], in: [] };
    (r.amount < 0 ? g.out : g.in).push(r);
    byAmount.set(key, g);
  }
  const near = (a: TransferCandidate, b: TransferCandidate) =>
    a.accountId !== b.accountId && Math.abs(daysBetween(a.date, b.date)) <= maxDays;

  const pairs: TransferPair[] = [];
  for (const g of byAmount.values()) {
    for (const out of g.out) {
      const partners = g.in.filter((i) => near(out, i));
      const [incoming] = partners;
      if (partners.length !== 1 || !incoming) continue;
      if (g.out.filter((o) => near(o, incoming)).length !== 1) continue;
      if (!out.fresh && !incoming.fresh) continue;
      const cardPayment = isLiability(incoming.accountType) && !isLiability(out.accountType);
      const worded =
        TRANSFER_WORDS.test(out.description) || TRANSFER_WORDS.test(incoming.description);
      if (cardPayment || worded) pairs.push({ outId: out.id, inId: incoming.id, cardPayment });
    }
  }
  return pairs;
}
