import { createAi } from "@mm/ai";
import { schema, seedDemoData, withHousehold } from "@mm/db";
import { createTestDatabase, type TestDatabase, testDatabaseUrl } from "@mm/db/testing";
import {
  execute,
  getCard,
  listCatalogChanges,
  sessionPrincipal,
  setWalletCard,
  updateCard,
} from "@mm/services";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalogRefresh } from "./catalog-refresh";

const adminUrl = testDatabaseUrl();
process.env.NTFY_ALLOW_PRIVATE = "1";
const PAGE = "https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred";

describe.skipIf(!adminUrl)("monthly catalog refresh (integration)", () => {
  let t: TestDatabase;
  let optedIn: string;
  let optedOut: string;
  const requests: Record<string, unknown>[] = [];
  const pushed: string[] = [];

  const reply = (input: Record<string, unknown>) =>
    Response.json({
      id: `m${requests.length}`,
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 2000, output_tokens: 300 },
      content: [{ type: "tool_use", id: `tu${requests.length}`, name: "report", input }],
    });

  // First answer cites a page off the card's own sites (refused), the second the issuer's page.
  const anthropic = (async (_u: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    const patch = { annualFee: 105, name: "Renamed by a web page" };
    return requests.length === 1
      ? reply({ outcome: "changed", sourceUrl: "https://deals.example.com/csp", note: "x", patch })
      : reply({ outcome: "changed", sourceUrl: PAGE, note: "Annual fee is now $105.", patch });
  }) as unknown as typeof fetch;
  const ntfy = (async (_u: string | URL | Request, init?: RequestInit) => {
    pushed.push(String(init?.body));
    return new Response("{}");
  }) as unknown as typeof fetch;

  beforeAll(async () => {
    t = await createTestDatabase(adminUrl as string);
    optedIn = await t.household("In");
    optedOut = await t.household("Out");
    for (const h of [optedIn, optedOut]) {
      await seedDemoData(t.app, h, { months: 1 });
      const [m] = await t.admin
        .select()
        .from(schema.householdMembers)
        .where(eq(schema.householdMembers.householdId, h));
      const owner = sessionPrincipal({
        userId: m?.userId as string,
        householdId: h,
        role: "owner",
      });
      const account = await withHousehold(t.app, h, async (tx) => {
        const [c] = await tx
          .select()
          .from(schema.accounts)
          .where(eq(schema.accounts.type, "credit"));
        await tx
          .update(schema.households)
          .set({
            ai: { enabled: true, catalogRefresh: h === optedIn },
            notifications: { ntfyUrl: "https://ntfy.example.test/t" },
          })
          .where(eq(schema.households.id, h));
        return c?.id as string;
      });
      await execute(t.app, owner, setWalletCard, {
        accountId: account,
        cardSlug: "chase_sapphire_preferred",
      });
      // Make the card look like it hasn't been checked in a while.
      await execute(t.app, owner, updateCard, {
        slug: "chase_sapphire_preferred",
        patch: {},
        sourceUrl: PAGE,
        asOf: "2026-01-05",
      });
    }
  });
  afterAll(() => t?.cleanup());

  it("checks stale wallet cards on their own sites and records the result as the refresher", async () => {
    const ai = createAi({ apiKey: "sk-test", fetch: anthropic });
    const sum = await catalogRefresh(t.app, ai, { fetch: ntfy });
    expect(sum).toMatchObject({ households: 1, checked: 1, changed: 1 });

    // Two model calls: the off-site source was sent back as an error, then corrected.
    expect(requests).toHaveLength(2);
    const tools = requests[0]?.tools as { name: string; allowed_domains?: string[] }[];
    // The page the household checked comes first, then the card's shipped sources (OCCB cites
    // reviews for the Sapphire Preferred, not an issuer page).
    expect(tools.find((x) => x.name === "web_fetch")?.allowed_domains).toEqual([
      "chase.com",
      "onemileatatime.com",
      "eyeoftheflyer.com",
    ]);
    const sent = JSON.stringify(requests[0]);
    expect(sent).toContain("chase_sapphire_preferred");
    expect(sent).not.toMatch(/Checking|Savings|Whole Foods|household/i);

    const ownerOf = async (h: string) => {
      const [m] = await t.admin
        .select()
        .from(schema.householdMembers)
        .where(eq(schema.householdMembers.householdId, h));
      return sessionPrincipal({ userId: m?.userId as string, householdId: h, role: "owner" });
    };
    const inOwner = await ownerOf(optedIn);
    const card = await execute(t.app, inOwner, getCard, { slug: "chase_sapphire_preferred" });
    expect(card.annualFee).toBe(105);
    // Only rate and fee fields come from the refresher; the name stays.
    expect(card.name).toBe("Sapphire Preferred");
    const [latest] = (await execute(t.app, inOwner, listCatalogChanges, { limit: 1 })).changes;
    expect(latest).toMatchObject({
      via: "worker",
      sourceUrl: PAGE,
      note: "Annual fee is now $105.",
    });
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toContain("Updated from issuers' pages: Chase Sapphire Preferred.");

    const usage = await withHousehold(t.app, optedIn, (tx) =>
      tx.select().from(schema.aiUsage).where(eq(schema.aiUsage.feature, "catalog_refresh")),
    );
    expect(usage).toHaveLength(1);

    // The household that didn't turn it on is untouched.
    const out = await execute(t.app, await ownerOf(optedOut), getCard, {
      slug: "chase_sapphire_preferred",
    });
    expect(out.annualFee).toBe(95);
  });
});
