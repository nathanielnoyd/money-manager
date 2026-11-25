import { describe, expect, it } from "vitest";
import { ConnectorError, createSimpleFinConnector, parseSetupToken } from "./index";

const b64 = (s: string) => Buffer.from(s).toString("base64");

function fakeFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}

describe("parseSetupToken", () => {
  it("accepts a token for an allowed HTTPS host", () => {
    expect(
      parseSetupToken(b64("https://beta-bridge.simplefin.org/simplefin/claim/ABC123")).hostname,
    ).toBe("beta-bridge.simplefin.org");
  });
  it.each([
    ["http (not https)", "http://beta-bridge.simplefin.org/claim/x"],
    ["internal host (SSRF)", "https://169.254.169.254/latest/meta-data"],
    ["look-alike host", "https://simplefin.org.evil.example/claim/x"],
  ])("rejects %s", (_, url) => {
    expect(() => parseSetupToken(b64(url))).toThrow(ConnectorError);
  });
  it("rejects garbage", () => expect(() => parseSetupToken("hello")).toThrow(/doesn't look like/));
});

describe("SimpleFIN connector", () => {
  const access = "https://user%40x:p%3Ass@bridge.simplefin.org/simplefin";

  it("claims a token with POST and returns the access URL", async () => {
    const calls: string[] = [];
    const c = createSimpleFinConnector({
      fetch: fakeFetch((url, init) => {
        calls.push(`${init?.method} ${url}`);
        return new Response(`${access}\n`);
      }),
    });
    const r = await c.completeLink(b64("https://bridge.simplefin.org/simplefin/claim/TOKEN"));
    expect(r.secret).toBe(access);
    expect(calls).toEqual(["POST https://bridge.simplefin.org/simplefin/claim/TOKEN"]);
  });

  it("warns that a 403 on claim may mean the token was intercepted", async () => {
    const c = createSimpleFinConnector({
      fetch: fakeFetch(() => new Response("", { status: 403 })),
    });
    await expect(c.completeLink(b64("https://bridge.simplefin.org/claim/T"))).rejects.toThrow(
      /intercepted/,
    );
  });

  it("syncs accounts and transactions using Basic auth (credentials never in the URL)", async () => {
    let seen: { url: string; auth: string | null } | undefined;
    const now = new Date("2026-03-15T12:00:00Z");
    const c = createSimpleFinConnector({
      fetch: fakeFetch((url, init) => {
        seen = { url, auth: new Headers(init?.headers).get("authorization") };
        return Response.json({
          errlist: [{ code: "con.auth", msg: "Chase needs <b>reauth</b>" }],
          connections: [{ conn_id: "c1", name: "Chase" }],
          accounts: [
            {
              id: "a1",
              name: "Sapphire Preferred 1107",
              conn_id: "c1",
              currency: "USD",
              balance: "-1234.56",
              "balance-date": 1773500000,
              transactions: [
                { id: "t1", posted: 1773400000, amount: "-15.49", description: "NETFLIX.COM" },
                {
                  id: "t2",
                  posted: 0,
                  transacted_at: 1773550000,
                  amount: "-4.50",
                  description: "STARBUCKS",
                  pending: true,
                },
              ],
            },
            {
              id: "a2",
              name: "Total Checking",
              conn_id: "c1",
              currency: "USD",
              balance: "2500.00",
              "available-balance": "2400",
              "balance-date": 1773500000,
            },
          ],
        });
      }),
    });
    const r = await c.sync({ secret: access, cursor: null, now });
    expect(seen?.url).toMatch(
      /^https:\/\/bridge\.simplefin\.org\/simplefin\/accounts\?version=2&pending=1&start-date=\d+$/,
    );
    expect(seen?.url).not.toContain("@");
    expect(seen?.auth).toBe(`Basic ${Buffer.from("user@x:p:ss").toString("base64")}`);
    expect(r.accounts).toMatchObject([
      {
        providerAccountId: "a1",
        type: "credit",
        mask: "1107",
        balance: -123456,
        institutionName: "Chase",
      },
      {
        providerAccountId: "a2",
        type: "depository",
        subtype: "checking",
        balance: 250000,
        availableBalance: 240000,
      },
    ]);
    expect(r.transactions).toEqual([
      {
        providerTransactionId: "t1",
        providerAccountId: "a1",
        date: "2026-03-13",
        amount: -1549,
        pending: false,
        description: "NETFLIX.COM",
      },
      {
        providerTransactionId: "t2",
        providerAccountId: "a1",
        date: "2026-03-15",
        amount: -450,
        pending: true,
        description: "STARBUCKS",
      },
    ]);
    expect(r.warnings).toEqual(["Chase needs breauth/b"]);
    expect(r.window).toEqual({ start: "2026-01-14", end: "2026-03-15" });
  });

  it("maps 403 on /accounts to a reauth error", async () => {
    const c = createSimpleFinConnector({
      fetch: fakeFetch(() => new Response("", { status: 403 })),
    });
    const err = await c.sync({ secret: access, cursor: null }).catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.kind).toBe("reauth");
  });
});
