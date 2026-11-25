import { parseDecimalToMinor } from "@mm/core";
import { guessAccountType } from "./account-type";
import {
  type Connector,
  ConnectorError,
  type NormalizedAccount,
  type NormalizedTransaction,
  type SyncResult,
} from "./types";

/**
 * SimpleFIN (https://www.simplefin.org/protocol.html).
 * - Setup token: base64 of a claim URL. POST to it once → Access URL with Basic-auth credentials.
 * - GET {access}/accounts?version=2&pending=1&start-date=<epoch> → accounts with transactions.
 * The Access URL is the long-lived secret; it is sealed at rest and only opened by the worker.
 */

export interface SimpleFinOptions {
  fetch?: typeof fetch;
  /** Hostname suffixes allowed for claim and access URLs (SSRF guard). */
  allowedHostSuffixes?: string[];
  /** Days of history per sync request. SimpleFIN Bridge serves roughly 90 days. */
  windowDays?: number;
  /** Tests only: permit http:// for localhost. */
  allowInsecureLocalhost?: boolean;
}

const DEFAULT_SUFFIXES = ["simplefin.org"];

function checkUrl(raw: string, opts: SimpleFinOptions): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConnectorError("That doesn't look like a SimpleFIN setup token.", "fatal");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(opts.allowInsecureLocalhost && local)) {
    throw new ConnectorError("SimpleFIN URLs must use HTTPS.", "fatal");
  }
  const suffixes = opts.allowedHostSuffixes ?? DEFAULT_SUFFIXES;
  const hostOk =
    (opts.allowInsecureLocalhost && local) ||
    suffixes.some((s) => url.hostname === s || url.hostname.endsWith(`.${s}`));
  if (!hostOk) {
    throw new ConnectorError(
      `SimpleFIN host ${url.hostname} isn't allowed (allowed: ${suffixes.join(", ")}). Set SIMPLEFIN_ALLOWED_HOSTS to trust another server.`,
      "fatal",
    );
  }
  return url;
}

/** Decode and validate a setup token without contacting anything. Used by the web tier for early feedback. */
export function parseSetupToken(token: string, opts: SimpleFinOptions = {}): URL {
  const trimmed = token.trim();
  if (!/^[A-Za-z0-9+/=_-]{20,2000}$/.test(trimmed)) {
    throw new ConnectorError("That doesn't look like a SimpleFIN setup token.", "fatal");
  }
  const decoded = Buffer.from(trimmed, "base64").toString("utf8").trim();
  return checkUrl(decoded, opts);
}

function authParts(
  accessUrl: string,
  opts: SimpleFinOptions,
): { base: string; authorization: string } {
  const url = checkUrl(accessUrl, opts);
  if (!url.username)
    throw new ConnectorError("Stored SimpleFIN access URL has no credentials.", "reauth");
  const authorization = `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString("base64")}`;
  url.username = "";
  url.password = "";
  return { base: url.toString().replace(/\/$/, ""), authorization };
}

interface SfAccount {
  id: string;
  name: string;
  conn_id?: string;
  org?: { name?: string; domain?: string };
  currency: string;
  balance: string;
  "available-balance"?: string;
  "balance-date": number;
  transactions?: {
    id: string;
    posted: number;
    amount: string;
    description: string;
    transacted_at?: number;
    pending?: boolean;
    payee?: string;
  }[];
}

interface SfAccountSet {
  errlist?: { code: string; msg: string; conn_id?: string; account_id?: string }[];
  errors?: string[];
  connections?: { conn_id: string; name: string }[];
  accounts: SfAccount[];
}

const isoDay = (epochSeconds: number) => new Date(epochSeconds * 1000).toISOString().slice(0, 10);

/** Strip anything that could be markup from provider messages before showing them. */
const sanitize = (s: string) => s.replace(/[<>]/g, "").slice(0, 300);

export function createSimpleFinConnector(opts: SimpleFinOptions = {}): Connector {
  const doFetch = opts.fetch ?? fetch;
  const windowDays = opts.windowDays ?? 60;

  return {
    id: "simplefin",

    async completeLink(setupToken) {
      const claimUrl = parseSetupToken(setupToken, opts);
      const res = await doFetch(claimUrl, {
        method: "POST",
        headers: { "content-length": "0" },
        redirect: "error",
      });
      if (res.status === 403) {
        throw new ConnectorError(
          "SimpleFIN rejected this setup token: it was already used or doesn't exist. If you didn't use it, revoke it in SimpleFIN Bridge, since it may have been intercepted.",
          "fatal",
        );
      }
      if (!res.ok)
        throw new ConnectorError(`SimpleFIN claim failed (HTTP ${res.status}).`, "retry");
      const accessUrl = (await res.text()).trim();
      authParts(accessUrl, opts); // validate before we store it
      return { secret: accessUrl, institutionName: "SimpleFIN Bridge" };
    },

    async sync({ secret, now = new Date() }): Promise<SyncResult> {
      const { base, authorization } = authParts(secret, opts);
      const startEpoch = Math.floor(now.getTime() / 1000) - windowDays * 86_400;
      const url = `${base}/accounts?version=2&pending=1&start-date=${startEpoch}`;
      const res = await doFetch(url, {
        headers: { authorization, accept: "application/json" },
        redirect: "error",
      });
      if (res.status === 403)
        throw new ConnectorError(
          "SimpleFIN access was revoked or is invalid. Reconnect to continue syncing.",
          "reauth",
        );
      if (res.status === 402)
        throw new ConnectorError("Your SimpleFIN Bridge subscription needs payment.", "reauth");
      if (!res.ok)
        throw new ConnectorError(`SimpleFIN request failed (HTTP ${res.status}).`, "retry");
      const body = (await res.json()) as SfAccountSet;

      const connNames = new Map((body.connections ?? []).map((c) => [c.conn_id, c.name]));
      const accounts: NormalizedAccount[] = [];
      const transactions: NormalizedTransaction[] = [];
      for (const a of body.accounts ?? []) {
        const balance = parseDecimalToMinor(a.balance) ?? 0;
        const available =
          a["available-balance"] !== undefined ? parseDecimalToMinor(a["available-balance"]) : null;
        const mask = /(\d{4})\D*$/.exec(a.name)?.[1];
        accounts.push({
          providerAccountId: a.id,
          name: a.name,
          institutionName: (a.conn_id && connNames.get(a.conn_id)) || a.org?.name,
          ...guessAccountType(a.name, balance),
          mask,
          currency: /^[A-Z]{3}$/.test(a.currency) ? a.currency : "USD",
          balance,
          availableBalance: available ?? undefined,
          balanceDate: new Date(a["balance-date"] * 1000),
        });
        for (const t of a.transactions ?? []) {
          const amount = parseDecimalToMinor(t.amount);
          if (amount === null) continue;
          const pending = t.pending === true || t.posted === 0;
          const when = pending ? (t.transacted_at ?? Math.floor(now.getTime() / 1000)) : t.posted;
          transactions.push({
            providerTransactionId: t.id,
            providerAccountId: a.id,
            date: isoDay(when),
            amount,
            pending,
            description: (t.description || t.payee || "Unknown").trim(),
          });
        }
      }
      const warnings = [
        ...(body.errlist ?? []).map((e) => sanitize(e.msg)),
        ...(body.errors ?? []).map(sanitize),
      ];
      return {
        accounts,
        transactions,
        removed: [],
        window: { start: isoDay(startEpoch), end: isoDay(Math.floor(now.getTime() / 1000)) },
        nextCursor: null,
        warnings: [...new Set(warnings)],
      };
    },
  };
}
