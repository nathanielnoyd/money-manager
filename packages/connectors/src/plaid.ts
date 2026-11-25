import { parseDecimalToMinor } from "@mm/core";
import type {
  Connector,
  NormalizedAccount,
  NormalizedHolding,
  NormalizedTransaction,
  SyncResult,
} from "./types";
import { ConnectorError } from "./types";

/**
 * Plaid (bring your own keys). https://plaid.com/docs/api/
 * - The web tier creates a Link token and receives a short-lived public_token from Plaid Link.
 * - It seals that public_token to the worker; the worker exchanges it for the long-lived
 *   access_token, so only the worker ever holds access tokens.
 * - Transactions use /transactions/sync with a cursor (added / modified / removed).
 * Plaid amounts are positive for money OUT; we flip them to our convention.
 */

export type PlaidEnv = "sandbox" | "production";

export interface PlaidOptions {
  clientId: string;
  secret: string;
  env: PlaidEnv;
  fetch?: typeof fetch;
}

interface PlaidError {
  error_type?: string;
  error_code?: string;
  error_message?: string;
  display_message?: string | null;
}

const REAUTH = new Set([
  "ITEM_LOGIN_REQUIRED",
  "PENDING_EXPIRATION",
  "ITEM_LOCKED",
  "ACCESS_NOT_GRANTED",
  "NO_ACCOUNTS",
  "INVALID_ACCESS_TOKEN",
  "ITEM_NOT_FOUND",
]);
const RETRY = new Set([
  "RATE_LIMIT_EXCEEDED",
  "INTERNAL_SERVER_ERROR",
  "PLANNED_MAINTENANCE",
  "INSTITUTION_DOWN",
  "INSTITUTION_NOT_RESPONDING",
  "PRODUCT_NOT_READY",
  "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
]);

function plaidClient(opts: PlaidOptions) {
  const base =
    opts.env === "production" ? "https://production.plaid.com" : "https://sandbox.plaid.com";
  const doFetch = opts.fetch ?? fetch;
  return async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await doFetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "plaid-version": "2020-09-14" },
      body: JSON.stringify({ client_id: opts.clientId, secret: opts.secret, ...body }),
      redirect: "error",
    });
    const json = (await res.json().catch(() => ({}))) as T & PlaidError;
    if (!res.ok) {
      const code = json.error_code ?? `HTTP_${res.status}`;
      const msg = (json.display_message || json.error_message || `Plaid error ${code}`)
        .replace(/[<>]/g, "")
        .slice(0, 300);
      if (REAUTH.has(code))
        throw new ConnectorError(`${msg} Reconnect this institution to continue.`, "reauth");
      if (RETRY.has(code) || res.status >= 500) throw new ConnectorError(msg, "retry");
      throw new ConnectorError(msg, "fatal");
    }
    return json;
  };
}

/** Create a Link token for the browser. `userId` must be stable per app user (never PII). */
export async function createPlaidLinkToken(
  opts: PlaidOptions,
  userId: string,
  clientName = "Money Manager",
  redirectUri?: string,
): Promise<string> {
  const call = plaidClient(opts);
  const r = await call<{ link_token: string }>("/link/token/create", {
    client_name: clientName,
    ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    user: { client_user_id: userId },
    products: ["transactions"],
    // Ask for holdings where the institution supports it, without failing banks that don't.
    optional_products: ["investments"],
    country_codes: ["US", "CA"],
    language: "en",
    transactions: { days_requested: 730 },
  });
  return r.link_token;
}

interface PlaidAccount {
  account_id: string;
  name: string;
  official_name?: string | null;
  mask?: string | null;
  type: string;
  subtype?: string | null;
  balances: {
    current: number | null;
    available: number | null;
    iso_currency_code?: string | null;
    unofficial_currency_code?: string | null;
  };
}

interface PlaidTxn {
  transaction_id: string;
  account_id: string;
  amount: number;
  date: string;
  authorized_date?: string | null;
  pending: boolean;
  pending_transaction_id?: string | null;
  name: string;
  merchant_name?: string | null;
  iso_currency_code?: string | null;
  personal_finance_category?: { primary?: string | null; detailed?: string | null } | null;
}

const minor = (n: number | null | undefined) =>
  n === null || n === undefined ? undefined : (parseDecimalToMinor(String(n)) ?? undefined);

function mapType(t: string): NormalizedAccount["type"] {
  if (t === "depository" || t === "credit" || t === "loan" || t === "investment") return t;
  if (t === "brokerage") return "investment";
  return "other";
}

export function createPlaidConnector(opts: PlaidOptions): Connector {
  const call = plaidClient(opts);

  return {
    id: "plaid",

    /** `input` is JSON: { publicToken, institutionName } from Plaid Link's onSuccess. */
    async completeLink(input) {
      let parsed: { publicToken?: string; institutionName?: string };
      try {
        parsed = JSON.parse(input);
      } catch {
        throw new ConnectorError("Malformed Plaid link payload.", "fatal");
      }
      if (!parsed.publicToken) throw new ConnectorError("Missing Plaid public token.", "fatal");
      const r = await call<{ access_token: string }>("/item/public_token/exchange", {
        public_token: parsed.publicToken,
      });
      return {
        secret: r.access_token,
        institutionName: (parsed.institutionName || "Plaid").slice(0, 80),
      };
    },

    async sync({ secret, cursor }): Promise<SyncResult> {
      const acc = await call<{ accounts: PlaidAccount[] }>("/accounts/get", {
        access_token: secret,
      });
      const accounts: NormalizedAccount[] = acc.accounts.map((a) => {
        const type = mapType(a.type);
        const owed = type === "credit" || type === "loan";
        const current = minor(a.balances.current) ?? 0;
        const available = minor(a.balances.available);
        return {
          providerAccountId: a.account_id,
          name: a.official_name || a.name,
          type,
          subtype: a.subtype ?? undefined,
          mask: a.mask ?? undefined,
          currency: a.balances.iso_currency_code ?? "USD",
          balance: owed ? -current : current,
          availableBalance: available === undefined ? undefined : owed ? undefined : available,
        };
      });

      const added: NormalizedTransaction[] = [];
      const removed: string[] = [];
      let next = cursor ?? "";
      const toTxn = (t: PlaidTxn): NormalizedTransaction => ({
        providerTransactionId: t.transaction_id,
        providerAccountId: t.account_id,
        date: t.date,
        amount: -(minor(t.amount) ?? 0),
        pending: t.pending,
        description: t.name,
        merchantName: t.merchant_name ?? undefined,
        pendingTransactionId: t.pending_transaction_id ?? undefined,
        providerCategory: t.personal_finance_category?.detailed ?? undefined,
      });
      for (let page = 0; page < 50; page++) {
        const r = await call<{
          added: PlaidTxn[];
          modified: PlaidTxn[];
          removed: { transaction_id: string }[];
          next_cursor: string;
          has_more: boolean;
        }>("/transactions/sync", { access_token: secret, cursor: next || undefined, count: 500 });
        added.push(...r.added.map(toTxn), ...r.modified.map(toTxn));
        removed.push(...r.removed.map((x) => x.transaction_id));
        next = r.next_cursor;
        if (!r.has_more) break;
      }
      const warnings: string[] = [];
      let holdings: NormalizedHolding[] | undefined;
      if (acc.accounts.some((a) => mapType(a.type) === "investment")) {
        try {
          holdings = await fetchHoldings(call, secret);
        } catch (e) {
          // Investments not consented/supported for this item: keep transactions flowing.
          if (e instanceof ConnectorError && e.kind === "reauth") throw e;
          warnings.push("Holdings unavailable for this institution.");
        }
      }
      return {
        accounts,
        transactions: added,
        removed,
        nextCursor: next || null,
        warnings,
        holdings,
      };
    },
  };
}

interface PlaidHolding {
  account_id: string;
  security_id: string;
  quantity: number;
  institution_price?: number | null;
  institution_value?: number | null;
  institution_price_as_of?: string | null;
  cost_basis?: number | null;
  iso_currency_code?: string | null;
}

interface PlaidSecurity {
  security_id: string;
  ticker_symbol?: string | null;
  name?: string | null;
  type?: string | null;
  close_price?: number | null;
  close_price_as_of?: string | null;
  iso_currency_code?: string | null;
}

async function fetchHoldings(
  call: <T>(path: string, body: Record<string, unknown>) => Promise<T>,
  accessToken: string,
): Promise<NormalizedHolding[]> {
  const r = await call<{ holdings: PlaidHolding[]; securities: PlaidSecurity[] }>(
    "/investments/holdings/get",
    {
      access_token: accessToken,
    },
  );
  const secs = new Map(r.securities.map((s) => [s.security_id, s]));
  return r.holdings.map((h) => {
    const s = secs.get(h.security_id);
    const price = h.institution_price ?? s?.close_price ?? undefined;
    return {
      providerAccountId: h.account_id,
      security: {
        providerSecurityId: h.security_id,
        symbol: s?.ticker_symbol ?? undefined,
        name: s?.name || s?.ticker_symbol || "Unknown security",
        type: s?.type ?? undefined,
        currency: h.iso_currency_code ?? s?.iso_currency_code ?? "USD",
        price: price === undefined ? undefined : String(price),
        priceAsOf: h.institution_price_as_of ?? s?.close_price_as_of ?? undefined,
      },
      quantity: String(h.quantity),
      value: minor(h.institution_value) ?? 0,
      costBasis: minor(h.cost_basis),
    };
  });
}
