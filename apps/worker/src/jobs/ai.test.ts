import { createAi } from "@mm/ai";
import { schema, seedDemoData, withHousehold } from "@mm/db";
import { createTestDatabase, type TestDatabase, testDatabaseUrl } from "@mm/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { weeklyDigests } from "./ai";

const adminUrl = testDatabaseUrl();
// Fake ntfy hosts don't resolve in tests; the URL guard has its own tests in @mm/connectors.
process.env.NTFY_ALLOW_PRIVATE = "1";

describe.skipIf(!adminUrl)("weekly digests (integration)", () => {
  let t: TestDatabase;
  let optedIn: string;
  let optedOut: string;
  const pushed: { title: string | null; body: string }[] = [];
  let apiCalls = 0;

  const anthropic = (async () => {
    apiCalls++;
    return Response.json({
      id: "m",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 800, output_tokens: 120 },
      content: [
        {
          type: "text",
          text: JSON.stringify({
            title: "Quiet week",
            summary: "Spending was a little below usual.",
            highlights: ["Groceries were the biggest category"],
          }),
        },
      ],
    });
  }) as unknown as typeof fetch;
  const ntfy = (async (_u: string | URL | Request, init?: RequestInit) => {
    pushed.push({ title: new Headers(init?.headers).get("title"), body: String(init?.body) });
    return new Response("{}");
  }) as unknown as typeof fetch;

  beforeAll(async () => {
    t = await createTestDatabase(adminUrl as string);
    optedIn = await t.household("In");
    optedOut = await t.household("Out");
    await seedDemoData(t.app, optedIn, { months: 3 });
    await withHousehold(t.app, optedIn, (tx) =>
      tx
        .update(schema.households)
        .set({
          ai: { enabled: true, digest: true },
          notifications: { ntfyUrl: "https://ntfy.example.test/t" },
        })
        .where(eq(schema.households.id, optedIn)),
    );
    await withHousehold(t.app, optedOut, (tx) =>
      tx
        .update(schema.households)
        .set({ ai: { enabled: true, digest: false } })
        .where(eq(schema.households.id, optedOut)),
    );
  });
  afterAll(() => t?.cleanup());

  it("writes, stores and pushes digests only for households that opted in", async () => {
    const ai = createAi({ apiKey: "sk-test", fetch: anthropic });
    expect(await weeklyDigests(t.app, ai, { fetch: ntfy })).toBe(1);
    expect(apiCalls).toBe(1);
    expect(pushed).toEqual([
      {
        title: "Quiet week",
        body: "Spending was a little below usual.\n• Groceries were the biggest category",
      },
    ]);
    const stored = await withHousehold(t.app, optedIn, (tx) => tx.select().from(schema.insights));
    expect(stored).toHaveLength(1);
    const none = await withHousehold(t.app, optedOut, (tx) => tx.select().from(schema.insights));
    expect(none).toHaveLength(0);
  });
});
