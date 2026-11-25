import { schema, seedDemoData, withHousehold } from "@mm/db";
import { createTestDatabase, type TestDatabase, testDatabaseUrl } from "@mm/db/testing";
import { eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AiBudgetError,
  aiBudget,
  categorizeUncategorized,
  createAi,
  findAnomalies,
  generateWeeklyDigest,
} from "./index";

const adminUrl = testDatabaseUrl();
const TODAY = "2026-06-30";

function fakeAi(reply: (body: { messages: { content: string }[] }) => unknown) {
  const sent: string[] = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    sent.push(JSON.stringify(body));
    return Response.json({
      id: "msg",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 150 },
      content: [{ type: "text", text: JSON.stringify(reply(body)) }],
    });
  }) as typeof fetch;
  return { sent, ai: createAi({ apiKey: "sk-test", fetch: fetchImpl }) };
}

describe.skipIf(!adminUrl)("AI apply (integration)", () => {
  let t: TestDatabase;
  let h: string;
  let accountId: string;

  beforeAll(async () => {
    t = await createTestDatabase(adminUrl as string);
    h = await t.household();
    await seedDemoData(t.app, h, { months: 4, today: new Date(TODAY) });
    await withHousehold(t.app, h, async (tx) => {
      const [a] = await tx
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.name, "Everyday Checking"));
      accountId = a?.id as string;
      await tx.insert(schema.transactions).values([
        {
          householdId: h,
          accountId,
          date: "2026-06-29",
          amount: -575,
          rawDescription: "SQ *RITUAL COFFEE ROASTERS",
        },
        {
          householdId: h,
          accountId,
          date: "2026-06-29",
          amount: -1999,
          rawDescription: "MYSTERY CHARGE 0091",
        },
      ]);
    });
  });
  afterAll(() => t?.cleanup());

  it("applies confident suggestions only, marks them as AI and unreviewed, and records usage", async () => {
    const { sent, ai } = fakeAi((body) => {
      const payload = JSON.parse(body.messages[0]?.content.split("\n\n")[1] ?? "{}");
      return {
        results: payload.transactions.map((tx: { ref: number; description: string }) =>
          tx.description.includes("RITUAL")
            ? { ref: tx.ref, category: "Coffee", confidence: "high" }
            : { ref: tx.ref, category: "Shopping", confidence: "low" },
        ),
      };
    });
    const r = await categorizeUncategorized(t.app, h, ai);
    expect(r).toEqual({ considered: 2, applied: 1 });
    // The household's own past choices were sent as examples; account names were not.
    expect(sent[0]).toContain("examples");
    expect(sent[0]).not.toContain("Everyday Checking");
    await withHousehold(t.app, h, async (tx) => {
      const [coffee] = await tx
        .select()
        .from(schema.transactions)
        .where(eq(schema.transactions.rawDescription, "SQ *RITUAL COFFEE ROASTERS"));
      expect(coffee).toMatchObject({ categorySource: "ai", reviewed: false });
      expect(coffee?.categoryId).not.toBeNull();
      const left = await tx
        .select()
        .from(schema.transactions)
        .where(isNull(schema.transactions.categoryId));
      expect(left.map((x) => x.rawDescription)).toEqual(["MYSTERY CHARGE 0091"]);
      const usage = await tx.select().from(schema.aiUsage);
      expect(usage).toMatchObject([
        { feature: "categorize", model: "claude-opus-5-5", inputTokens: 1000, outputTokens: 150 },
      ]);
    });
  });

  it("finds anomalies deterministically", async () => {
    const f = await withHousehold(t.app, h, (tx) => findAnomalies(tx, TODAY));
    expect(Array.isArray(f.sentences)).toBe(true);
  });

  it("writes the weekly digest from computed facts and stores it once per week", async () => {
    const { sent, ai } = fakeAi(() => ({
      title: "Steady week",
      summary: "You spent about what you usually do.",
      highlights: ["Groceries led spending"],
    }));
    const d = await generateWeeklyDigest(t.app, h, ai, TODAY);
    expect(d).toMatchObject({ title: "Steady week", periodStart: "2026-06-24" });
    const facts = JSON.parse(JSON.parse(sent[0] as string).messages[0].content.split("\n\n")[1]);
    expect(facts).toMatchObject({ weekStart: "2026-06-24", weekEnd: TODAY });
    expect(facts.spent).toBeGreaterThan(0);
    expect(facts.typicalWeeklySpend).toBeGreaterThan(0);
    await generateWeeklyDigest(t.app, h, ai, TODAY);
    const rows = await withHousehold(t.app, h, (tx) => tx.select().from(schema.insights));
    expect(rows).toHaveLength(1);
  });
  it("refuses further model calls once the month's token limit is used", async () => {
    await withHousehold(t.app, h, async (tx) => {
      await tx
        .update(schema.households)
        .set({ ai: { enabled: true, categorize: true, digest: true, monthlyTokenBudget: 60_000 } })
        .where(eq(schema.households.id, h));
      // Last month's usage doesn't count against this month.
      await tx.insert(schema.aiUsage).values([
        {
          householdId: h,
          feature: "ask",
          model: "m",
          inputTokens: 500_000,
          outputTokens: 0,
          createdAt: new Date(Date.now() - 40 * 86_400_000),
        },
        { householdId: h, feature: "ask", model: "m", inputTokens: 55_000, outputTokens: 5_000 },
      ]);
      await tx.insert(schema.transactions).values({
        householdId: h,
        accountId,
        date: "2026-06-29",
        amount: -1200,
        rawDescription: "UNKNOWN SHOP 7",
      });
      const b = await aiBudget(tx, h);
      expect(b.budget).toBe(60_000);
      expect(b.used).toBeGreaterThanOrEqual(60_000);
      expect(b.used).toBeLessThan(500_000);
    });
    const { sent, ai } = fakeAi(() => ({ results: [] }));
    await expect(categorizeUncategorized(t.app, h, ai)).rejects.toBeInstanceOf(AiBudgetError);
    await expect(generateWeeklyDigest(t.app, h, ai, TODAY)).rejects.toBeInstanceOf(AiBudgetError);
    expect(sent).toHaveLength(0);
  });
});
