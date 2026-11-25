import { parseDecimalToMinor } from "@mm/core";
import { Agent } from "undici";
import type { Connector, NormalizedAccount, NormalizedTransaction, SyncResult } from "./types";
import { ConnectorError } from "./types";

/**
 * Teller (https://teller.io/docs/api). Direct bank integrations, US only.
 * - Auth: the enrollment's access token as the HTTP Basic username (empty password).
 * - mTLS: a Teller client certificate is required in development/production, not sandbox.
 * - Teller Connect hands the access token to the browser on success; the web tier seals
 *   it straight away for the worker (the one provider where the browser briefly holds it).
 * - The docs don't pin down the sign of card transactions, so we detect it per account.
 */

export type TellerEnv = "sandbox" | "development" | "production";

export interface TellerOptions {
  env: TellerEnv;
  /** PEM client certificate + key (required unless env is sandbox). */
  cert?: string;
  key?: string;
  fetch?: typeof fetch;
  windowDays?: number;
}

interface TellerAccount {
  id: string;
  name: string;
  type: "depository" | "credit" | string;
  subtype?: string | null;
  last_four?: string | null;
  currency?: string | null;
  status?: string;
  institution?: { name?: string | null } | null;
}

interface TellerTxn {
  id: string;
  account_id: string;
  amount: string;
  date: string;
  description: string;
  status: "posted" | "pending";
  type?: string;
  details?: { counterparty?: { name?: string | null } | null } | null;
}

/** Card purchases should be negative (money out). If a card's purchases come back positive, flip it. */
export function cardSignFactor(txns: readonly Pick<TellerTxn, "amount" | "type">[]): 1 | -1 {
  const purchases = txns.filter((t) => t.type === "card_payment");
  const sample = purchases.length >= 2 ? purchases : txns;
  if (sample.length === 0) return 1;
  const positive = sample.filter((t) => (parseDecimalToMinor(t.amount) ?? 0) > 0).length;
  return positive > sample.length / 2 ? -1 : 1;
}

export function createTellerConnector(opts: TellerOptions): Connector {
  if (opts.env !== "sandbox" && (!opts.cert || !opts.key)) {
    throw new Error(
      "Teller development/production requires TELLER_CERT and TELLER_KEY (your client certificate).",
    );
  }
  const dispatcher =
    opts.cert && opts.key ? new Agent({ connect: { cert: opts.cert, key: opts.key } }) : undefined;
  const doFetch = opts.fetch ?? fetch;
  const windowDays = opts.windowDays ?? 60;

  async function get<T>(token: string, path: string): Promise<T> {
    const res = await doFetch(`https://api.teller.io${path}`, {
      headers: {
        authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}`,
        accept: "application/json",
        "teller-version": "2020-10-12",
      },
      redirect: "error",
      // undici-specific option for the client certificate (ignored by test fakes).
      ...(dispatcher ? ({ dispatcher } as Record<string, unknown>) : {}),
    });
    const body = (await res.json().catch(() => ({}))) as T & {
      error?: { code?: string; message?: string };
    };
    if (!res.ok) {
      const code = body.error?.code ?? `http_${res.status}`;
      const msg = (body.error?.message ?? `Teller error ${code}`)
        .replace(/[<>]/g, "")
        .slice(0, 300);
      if (code.startsWith("enrollment.disconnected") || res.status === 401 || res.status === 403) {
        throw new ConnectorError(`${msg} Reconnect this bank to continue syncing.`, "reauth");
      }
      if (res.status === 429 || res.status >= 500) throw new ConnectorError(msg, "retry");
      throw new ConnectorError(msg, "fatal");
    }
    return body;
  }

  return {
    id: "teller",

    /** `input` is JSON: { accessToken, institutionName } from Teller Connect's onSuccess. */
    async completeLink(input) {
      let p: { accessToken?: string; institutionName?: string };
      try {
        p = JSON.parse(input);
      } catch {
        throw new ConnectorError("Malformed Teller enrollment payload.", "fatal");
      }
      if (!p.accessToken) throw new ConnectorError("Missing Teller access token.", "fatal");
      return {
        secret: p.accessToken,
        institutionName: (p.institutionName || "Teller").slice(0, 80),
      };
    },

    async sync({ secret, now = new Date() }): Promise<SyncResult> {
      const raw = (await get<TellerAccount[]>(secret, "/accounts")).filter(
        (a) => a.status !== "closed",
      );
      const start = new Date(now.getTime() - windowDays * 86_400_000).toISOString().slice(0, 10);
      const accounts: NormalizedAccount[] = [];
      const transactions: NormalizedTransaction[] = [];
      for (const a of raw) {
        const bal = await get<{ ledger?: string | null; available?: string | null }>(
          secret,
          `/accounts/${a.id}/balances`,
        );
        const ledger = parseDecimalToMinor(bal.ledger ?? "0") ?? 0;
        const available = bal.available ? parseDecimalToMinor(bal.available) : null;
        const owed = a.type === "credit";
        accounts.push({
          providerAccountId: a.id,
          name: a.name,
          institutionName: a.institution?.name ?? undefined,
          type: owed ? "credit" : a.type === "depository" ? "depository" : "other",
          subtype: a.subtype ?? undefined,
          mask: a.last_four ?? undefined,
          currency: a.currency ?? "USD",
          balance: owed ? -Math.abs(ledger) : ledger,
          availableBalance: owed || available === null ? undefined : available,
        });
        const txns = await get<TellerTxn[]>(
          secret,
          `/accounts/${a.id}/transactions?start_date=${start}&count=1000`,
        );
        const factor = owed ? cardSignFactor(txns) : 1;
        for (const t of txns) {
          transactions.push({
            providerTransactionId: t.id,
            providerAccountId: a.id,
            date: t.date,
            amount: factor * (parseDecimalToMinor(t.amount) ?? 0),
            pending: t.status === "pending",
            description: t.description,
            merchantName: t.details?.counterparty?.name ?? undefined,
          });
        }
      }
      return {
        accounts,
        transactions,
        removed: [],
        window: { start, end: now.toISOString().slice(0, 10) },
        nextCursor: null,
        warnings: [],
      };
    },
  };
}
