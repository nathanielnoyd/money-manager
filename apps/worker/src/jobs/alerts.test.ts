import { parseNotifySettings } from "@mm/core";
import { schema, withHousehold } from "@mm/db";
import { createTestDatabase, type TestDatabase, testDatabaseUrl } from "@mm/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAlerts } from "./alerts";

const adminUrl = testDatabaseUrl();
// Fake ntfy hosts don't resolve in tests; the URL guard has its own tests in @mm/connectors.
process.env.NTFY_ALLOW_PRIVATE = "1";

describe("parseNotifySettings", () => {
  it("accepts only http(s) URLs and positive integer thresholds", () => {
    expect(
      parseNotifySettings({ ntfyUrl: "file:///etc/passwd", largeTransaction: -5 }),
    ).toMatchObject({ ntfyUrl: undefined, largeTransaction: undefined });
    expect(
      parseNotifySettings({ ntfyUrl: "https://ntfy.sh/abc", largeTransaction: 50000 }),
    ).toMatchObject({
      ntfyUrl: "https://ntfy.sh/abc",
      largeTransaction: 50000,
      includeAmounts: true,
    });
  });
});

describe.skipIf(!adminUrl)("runAlerts (integration)", () => {
  let t: TestDatabase;
  let h: string;
  const sent: { url: string; title: string | null; body: string; auth: string | null }[] = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    sent.push({
      url: String(url),
      title: headers.get("title"),
      body: String(init?.body),
      auth: headers.get("authorization"),
    });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  beforeAll(async () => {
    t = await createTestDatabase(adminUrl as string);
    h = await t.household();
    await withHousehold(t.app, h, async (tx) => {
      await tx
        .update(schema.households)
        .set({
          notifications: {
            ntfyUrl: "https://ntfy.example.test/topic",
            ntfyToken: "tk_1",
            largeTransaction: 50_000,
            lowBalance: 20_000,
          },
        })
        .where(eq(schema.households.id, h));
      const [a] = await tx
        .insert(schema.accounts)
        .values({ householdId: h, name: "Checking", type: "depository", currentBalance: 15_000 })
        .returning();
      await tx.insert(schema.transactions).values([
        {
          householdId: h,
          accountId: a?.id as string,
          date: "2026-03-09",
          amount: -81_200,
          rawDescription: "COSTCO WHSE",
        },
        {
          householdId: h,
          accountId: a?.id as string,
          date: "2026-03-09",
          amount: -1_200,
          rawDescription: "CAFE",
        },
      ]);
    });
  });
  afterAll(() => t?.cleanup());

  it("sends each alert once to the configured ntfy topic", async () => {
    const since = new Date(Date.now() - 60_000);
    const now = new Date("2026-03-10T12:00:00Z");
    expect(await runAlerts(t.app, h, since, { now, fetch: fakeFetch })).toBe(2);
    expect(sent.map((s) => s.title).sort()).toEqual(["Large charge", "Low balance"]);
    expect(
      sent.every((s) => s.url === "https://ntfy.example.test/topic" && s.auth === "Bearer tk_1"),
    ).toBe(true);
    expect(sent.find((s) => s.title === "Large charge")?.body).toBe(
      "$812.00 at COSTCO WHSE · Checking",
    );
    // Second run: everything was logged, nothing re-sent.
    expect(await runAlerts(t.app, h, since, { now, fetch: fakeFetch })).toBe(0);
    expect(sent).toHaveLength(2);
  });

  it("sends card rewards reminders once each when turned on", async () => {
    await withHousehold(t.app, h, async (tx) => {
      const [hh] = await tx.select().from(schema.households).where(eq(schema.households.id, h));
      await tx
        .update(schema.households)
        .set({ notifications: { ...(hh?.notifications as object), rewardReminders: true } })
        .where(eq(schema.households.id, h));
      const [card] = await tx
        .insert(schema.accounts)
        .values({ householdId: h, name: "Freedom Flex", type: "credit" })
        .returning();
      await tx.insert(schema.walletCards).values({
        householdId: h,
        accountId: card?.id as string,
        cardSlug: "chase_freedom_flex",
        signupBonus: {
          points: 20000,
          minSpend: 500,
          deadline: "2026-11-25",
          startDate: "2026-09-01",
        },
      });
    });
    const since = new Date(Date.now() - 60_000);
    const now = new Date("2026-11-10T12:00:00Z");
    sent.length = 0;
    await runAlerts(t.app, h, since, { now, fetch: fakeFetch });
    const titles = sent.map((x) => x.title);
    expect(titles).toContain("Activate Chase Freedom Flex bonus categories");
    expect(titles).toContain("Chase Freedom Flex: 15 days left for the sign-up bonus");
    expect(sent.find((x) => x.title?.includes("sign-up"))?.body).toMatch(
      /Spend \$500 more by 2026-11-25/,
    );
    sent.length = 0;
    await runAlerts(t.app, h, since, { now, fetch: fakeFetch });
    expect(sent.filter((x) => x.title?.includes("Freedom Flex"))).toEqual([]);
  });
});
