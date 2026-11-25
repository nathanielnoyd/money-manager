/**
 * Provider-agnostic bank data connectors. Every aggregator implements `Connector`,
 * so the sync engine and UI never depend on a specific vendor.
 * Connectors only fetch and normalise; persisting is the sync engine's job.
 */

export type ProviderId = "simplefin" | "plaid" | "teller" | "file";

export interface NormalizedAccount {
  providerAccountId: string;
  name: string;
  institutionName?: string;
  /** Best guess; users can change it and the sync engine keeps their choice. */
  type: "depository" | "credit" | "loan" | "investment" | "property" | "other";
  subtype?: string;
  mask?: string;
  currency: string;
  /** Minor units from the ASSET perspective: negative = money owed (as banks report cards/loans). */
  balance: number;
  availableBalance?: number;
  balanceDate?: Date;
}

export interface NormalizedTransaction {
  providerTransactionId: string;
  providerAccountId: string;
  date: string; // YYYY-MM-DD
  /** Minor units; positive = money in, negative = money out. */
  amount: number;
  pending: boolean;
  description: string;
  /** Clean merchant name if the provider supplies one. */
  merchantName?: string;
  /** On a posted transaction: provider id of the pending transaction it replaces. */
  pendingTransactionId?: string;
  /** Provider's own category, e.g. Plaid personal_finance_category.detailed. A hint only. */
  providerCategory?: string;
}

export interface SyncResult {
  accounts: NormalizedAccount[];
  transactions: NormalizedTransaction[];
  /** Provider ids deleted upstream (cursor-based providers like Plaid). */
  removed: string[];
  /** Window the provider returned in full; stored pending rows inside it that weren't returned are gone. */
  window?: { start: string; end: string };
  nextCursor: string | null;
  /** Non-fatal provider messages to show the user (e.g. "reconnect Chase"). */
  warnings: string[];
  /**
   * Full current holdings for investment accounts (replaces what's stored for those
   * accounts). Undefined = provider doesn't report holdings; leave stored ones alone.
   */
  holdings?: NormalizedHolding[];
}

export interface NormalizedHolding {
  providerAccountId: string;
  security: {
    providerSecurityId: string;
    symbol?: string;
    name: string;
    type?: string;
    currency: string;
    /** Exact decimal string. */
    price?: string;
    priceAsOf?: string;
  };
  /** Exact decimal string (fractional shares). */
  quantity: string;
  /** Minor units. */
  value: number;
  costBasis?: number;
}

export interface Connector {
  id: ProviderId;
  /** Exchange what the user pasted/approved for a long-lived secret. */
  completeLink(input: string): Promise<{ secret: string; institutionName: string }>;
  sync(ctx: { secret: string; cursor: string | null; now?: Date }): Promise<SyncResult>;
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    /** `reauth` = user must reconnect; `retry` = transient; `fatal` = configuration problem. */
    public kind: "reauth" | "retry" | "fatal",
  ) {
    super(message);
  }
}
