import { describe, expect, it } from "vitest";
import { type ConnectorError, createPlaidConnector } from "./index";

type Handler = (path: string, body: Record<string, unknown>) => { status?: number; json: unknown };
const fake = (h: Handler): typeof fetch =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    const r = h(new URL(String(url)).pathname, JSON.parse(String(init?.body)));
    return Response.json(r.json, { status: r.status ?? 200 });
  }) as typeof fetch;

const opts = { clientId: "cid", secret: "sec", env: "sandbox" as const };

describe("Plaid connector", () => {
  it("exchanges the public token with client credentials", async () => {
    const seen: Record<string, unknown>[] = [];
    const c = createPlaidConnector({
      ...opts,
      fetch: fake((path, body) => {
        seen.push({ path, ...body });
        return { json: { access_token: "access-sandbox-1", item_id: "i" } };
      }),
    });
    const r = await c.completeLink(
      JSON.stringify({ publicToken: "public-sandbox-1", institutionName: "Chase" }),
    );
    expect(r).toEqual({ secret: "access-sandbox-1", institutionName: "Chase" });
    expect(seen[0]).toMatchObject({
      path: "/item/public_token/exchange",
      client_id: "cid",
      secret: "sec",
      public_token: "public-sandbox-1",
    });
  });

  it("normalises accounts and paginates /transactions/sync, flipping Plaid's sign", async () => {
    const cursors: unknown[] = [];
    const c = createPlaidConnector({
      ...opts,
      fetch: fake((path, body) => {
        if (path === "/accounts/get")
          return {
            json: {
              accounts: [
                {
                  account_id: "chk",
                  name: "Checking",
                  mask: "0001",
                  type: "depository",
                  subtype: "checking",
                  balances: { current: 1250.5, available: 1200, iso_currency_code: "USD" },
                },
                {
                  account_id: "cc",
                  name: "Card",
                  official_name: "Sapphire Preferred",
                  mask: "1107",
                  type: "credit",
                  subtype: "credit card",
                  balances: { current: 410.25, available: 9589.75, iso_currency_code: "USD" },
                },
              ],
            },
          };
        cursors.push(body.cursor);
        if (!body.cursor)
          return {
            json: {
              added: [
                {
                  transaction_id: "t1",
                  account_id: "cc",
                  amount: 15.49,
                  date: "2026-03-03",
                  pending: false,
                  name: "NETFLIX.COM",
                  merchant_name: "Netflix",
                },
              ],
              modified: [],
              removed: [],
              next_cursor: "c1",
              has_more: true,
            },
          };
        return {
          json: {
            added: [
              {
                transaction_id: "t2",
                account_id: "chk",
                amount: -2500,
                date: "2026-03-05",
                pending: false,
                name: "ACME PAYROLL",
                pending_transaction_id: "p2",
              },
            ],
            modified: [],
            removed: [{ transaction_id: "p2" }],
            next_cursor: "c2",
            has_more: false,
          },
        };
      }),
    });
    const r = await c.sync({ secret: "access", cursor: null });
    expect(cursors).toEqual([undefined, "c1"]);
    expect(r.accounts).toEqual([
      {
        providerAccountId: "chk",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        mask: "0001",
        currency: "USD",
        balance: 125050,
        availableBalance: 120000,
      },
      {
        providerAccountId: "cc",
        name: "Sapphire Preferred",
        type: "credit",
        subtype: "credit card",
        mask: "1107",
        currency: "USD",
        balance: -41025,
        availableBalance: undefined,
      },
    ]);
    expect(
      r.transactions.map((t) => [
        t.providerTransactionId,
        t.amount,
        t.merchantName,
        t.pendingTransactionId,
      ]),
    ).toEqual([
      ["t1", -1549, "Netflix", undefined],
      ["t2", 250000, undefined, "p2"],
    ]);
    expect(r.removed).toEqual(["p2"]);
    expect(r.nextCursor).toBe("c2");
  });

  it("maps ITEM_LOGIN_REQUIRED to reauth and rate limits to retry", async () => {
    const err = (code: string) =>
      createPlaidConnector({
        ...opts,
        fetch: fake(() => ({
          status: 400,
          json: { error_code: code, error_message: "x", display_message: "Please log in again." },
        })),
      })
        .sync({ secret: "a", cursor: null })
        .catch((e: ConnectorError) => e.kind);
    expect(await err("ITEM_LOGIN_REQUIRED")).toBe("reauth");
    expect(await err("RATE_LIMIT_EXCEEDED")).toBe("retry");
    expect(await err("INVALID_FIELD")).toBe("fatal");
  });
});

describe("Plaid holdings", () => {
  it("returns holdings for investment items and degrades gracefully when unsupported", async () => {
    const mk = (holdingsResponse: { status?: number; json: unknown }) =>
      createPlaidConnector({
        ...opts,
        fetch: fake((path) => {
          if (path === "/accounts/get")
            return {
              json: {
                accounts: [
                  {
                    account_id: "ira",
                    name: "IRA",
                    type: "investment",
                    subtype: "ira",
                    balances: { current: 10500.25, available: null, iso_currency_code: "USD" },
                  },
                ],
              },
            };
          if (path === "/transactions/sync")
            return {
              json: { added: [], modified: [], removed: [], next_cursor: "c", has_more: false },
            };
          return holdingsResponse;
        }),
      });
    const ok = await mk({
      json: {
        holdings: [
          {
            account_id: "ira",
            security_id: "s1",
            quantity: 12.5,
            institution_price: 412.3,
            institution_value: 5153.75,
            cost_basis: 4000,
            iso_currency_code: "USD",
          },
        ],
        securities: [
          {
            security_id: "s1",
            ticker_symbol: "VTI",
            name: "Vanguard Total Stock Market ETF",
            type: "etf",
          },
        ],
      },
    }).sync({ secret: "a", cursor: null });
    expect(ok.holdings).toEqual([
      {
        providerAccountId: "ira",
        security: {
          providerSecurityId: "s1",
          symbol: "VTI",
          name: "Vanguard Total Stock Market ETF",
          type: "etf",
          currency: "USD",
          price: "412.3",
          priceAsOf: undefined,
        },
        quantity: "12.5",
        value: 515375,
        costBasis: 400000,
      },
    ]);
    const unsupported = await mk({
      status: 400,
      json: { error_code: "PRODUCTS_NOT_SUPPORTED", error_message: "no" },
    }).sync({ secret: "a", cursor: null });
    expect(unsupported.holdings).toBeUndefined();
    expect(unsupported.warnings).toEqual(["Holdings unavailable for this institution."]);
  });
});
