import { describe, expect, it } from "vitest";
import { ConnectorError, cardSignFactor, createTellerConnector } from "./index";

const fake = (
  routes: Record<string, { status?: number; json: unknown }>,
  seen: { path: string; auth: string | null }[] = [],
): typeof fetch =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const key = u.pathname;
    seen.push({
      path: `${u.pathname}${u.search}`,
      auth: new Headers(init?.headers).get("authorization"),
    });
    const r = routes[key] ?? { status: 404, json: { error: { code: "not_found", message: key } } };
    return Response.json(r.json, { status: r.status ?? 200 });
  }) as typeof fetch;

describe("Teller connector", () => {
  it("refuses to run outside sandbox without a client certificate", () => {
    expect(() => createTellerConnector({ env: "production" })).toThrow(/client certificate/);
  });

  it("syncs accounts, balances and transactions with Basic auth, flipping card signs when needed", async () => {
    const seen: { path: string; auth: string | null }[] = [];
    const c = createTellerConnector({
      env: "sandbox",
      fetch: fake(
        {
          "/accounts": {
            json: [
              {
                id: "chk",
                name: "Checking",
                type: "depository",
                subtype: "checking",
                last_four: "0001",
                currency: "USD",
                status: "open",
                institution: { name: "Chase" },
              },
              {
                id: "cc",
                name: "Freedom",
                type: "credit",
                subtype: "credit_card",
                last_four: "4242",
                currency: "USD",
                status: "open",
                institution: { name: "Chase" },
              },
              { id: "old", name: "Closed", type: "depository", status: "closed" },
            ],
          },
          "/accounts/chk/balances": { json: { ledger: "1250.50", available: "1200.00" } },
          "/accounts/cc/balances": { json: { ledger: "410.25", available: "9589.75" } },
          "/accounts/chk/transactions": {
            json: [
              {
                id: "t1",
                account_id: "chk",
                amount: "-86.20",
                date: "2026-03-02",
                description: "TRADER JOES",
                status: "posted",
                type: "card_payment",
                details: { counterparty: { name: "Trader Joe's" } },
              },
            ],
          },
          // This card reports purchases as positive: the connector must flip them.
          "/accounts/cc/transactions": {
            json: [
              {
                id: "c1",
                account_id: "cc",
                amount: "15.49",
                date: "2026-03-03",
                description: "NETFLIX",
                status: "posted",
                type: "card_payment",
              },
              {
                id: "c2",
                account_id: "cc",
                amount: "42.00",
                date: "2026-03-04",
                description: "SHELL",
                status: "pending",
                type: "card_payment",
              },
              {
                id: "c3",
                account_id: "cc",
                amount: "-300.00",
                date: "2026-03-05",
                description: "PAYMENT THANK YOU",
                status: "posted",
                type: "payment",
              },
            ],
          },
        },
        seen,
      ),
    });
    const r = await c.sync({
      secret: "token_abc",
      cursor: null,
      now: new Date("2026-03-10T00:00:00Z"),
    });
    expect(seen[0]?.auth).toBe(`Basic ${Buffer.from("token_abc:").toString("base64")}`);
    expect(seen.some((s) => s.path.startsWith("/accounts/old"))).toBe(false);
    expect(r.accounts.map((a) => [a.providerAccountId, a.type, a.balance, a.mask])).toEqual([
      ["chk", "depository", 125050, "0001"],
      ["cc", "credit", -41025, "4242"],
    ]);
    expect(
      r.transactions.map((t) => [t.providerTransactionId, t.amount, t.pending, t.merchantName]),
    ).toEqual([
      ["t1", -8620, false, "Trader Joe's"],
      ["c1", -1549, false, undefined],
      ["c2", -4200, true, undefined],
      ["c3", 30000, false, undefined],
    ]);
    expect(r.window).toEqual({ start: "2026-01-09", end: "2026-03-10" });
  });

  it("maps enrollment.disconnected to reauth", async () => {
    const c = createTellerConnector({
      env: "sandbox",
      fetch: fake({
        "/accounts": {
          status: 404,
          json: {
            error: {
              code: "enrollment.disconnected.user_action.mfa_required",
              message: "User MFA is required.",
            },
          },
        },
      }),
    });
    const e = await c.sync({ secret: "t", cursor: null }).catch((x: ConnectorError) => x);
    expect(e).toBeInstanceOf(ConnectorError);
    expect((e as ConnectorError).kind).toBe("reauth");
  });

  it("detects the card sign convention from purchases", () => {
    expect(
      cardSignFactor([
        { amount: "-10", type: "card_payment" },
        { amount: "-5", type: "card_payment" },
      ]),
    ).toBe(1);
    expect(
      cardSignFactor([
        { amount: "10", type: "card_payment" },
        { amount: "5", type: "card_payment" },
        { amount: "-100", type: "payment" },
      ]),
    ).toBe(-1);
  });
});
