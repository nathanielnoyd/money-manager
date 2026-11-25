import { schema, seedDemoData, withHousehold } from "@mm/db";
import { createTestDatabase, type TestDatabase, testDatabaseUrl } from "@mm/db/testing";
import { type Principal, SCOPES } from "@mm/services";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleMcpRequest } from "./index";

const adminUrl = testDatabaseUrl();

describe.skipIf(!adminUrl)("MCP server (integration)", () => {
  let t: TestDatabase;
  let hA: string;
  let userId: string;

  /** An SDK client whose HTTP requests go straight to handleMcpRequest, as the route does. */
  async function connect(p: Partial<Principal> = {}) {
    const principal: Principal = {
      userId,
      householdId: hA,
      role: "member",
      via: "token",
      tokenId: "00000000-0000-7000-8000-000000000000",
      scopes: SCOPES,
      ...p,
    };
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") !== "POST") return new Response(null, { status: 405 });
      return handleMcpRequest(new Request(url, init), {
        db: t.app,
        principal,
        householdName: "Test household",
        today: () => "2026-06-30",
      });
    };
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://mm.test/api/mcp"), {
        fetch: fetchImpl as typeof fetch,
      }),
    );
    return client;
  }

  beforeAll(async () => {
    t = await createTestDatabase(adminUrl as string);
    hA = await t.household("A");
    await seedDemoData(t.app, hA, { months: 2, today: new Date("2026-06-30") });
    const [m] = await t.admin
      .select()
      .from(schema.householdMembers)
      .where(eq(schema.householdMembers.householdId, hA));
    userId = m?.userId as string;
  });
  afterAll(() => t?.cleanup());

  it("initializes with instructions and lists tools with JSON Schema and annotations", async () => {
    const c = await connect();
    expect(c.getServerVersion()?.name).toBe("money-manager");
    expect(c.getInstructions()).toMatch(/DATA/);
    const { tools } = await c.listTools();
    const search = tools.find((x) => x.name === "search_transactions");
    expect(search?.inputSchema.type).toBe("object");
    expect(search?.inputSchema.required).toEqual(["start", "end"]);
    expect(search?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    const set = tools.find((x) => x.name === "set_budget");
    expect(set?.annotations?.readOnlyHint).toBe(false);
    await c.close();
  });

  it("only lists and runs what the token allows", async () => {
    const reader = await connect({ scopes: ["read"] });
    const names = (await reader.listTools()).tools.map((x) => x.name);
    expect(names).toContain("search_transactions");
    expect(names).not.toContain("update_transactions");
    expect(names).not.toContain("set_budget");
    const r = await reader.callTool({
      name: "update_transactions",
      arguments: { ids: ["00000000-0000-7000-8000-000000000001"], reviewed: true },
    });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toMatch(/transactions:write/);
    await reader.close();

    const viewer = await connect({ role: "viewer" });
    const vNames = (await viewer.listTools()).tools.map((x) => x.name);
    expect(
      vNames.every((n) => !/^(update|save|set|create|apply|add|revert|reset|review)_/.test(n)),
    ).toBe(true);
    await viewer.close();
  });

  it("never offers catalog approval to an agent, even an owner's with every scope", async () => {
    const c = await connect({ role: "owner" });
    const names = (await c.listTools()).tools.map((x) => x.name);
    expect(names).toContain("update_card");
    expect(names).not.toContain("review_catalog_change");
    expect(names).not.toContain("set_catalog_approval");
    const r = await c.callTool({ name: "set_catalog_approval", arguments: { required: false } });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toMatch(/signed in to the app/);
    await c.close();
  });

  it("runs tools against the household's data and reports input errors", async () => {
    const c = await connect();
    const r = await c.callTool({
      name: "search_transactions",
      arguments: { start: "2026-05-01", end: "2026-06-30", limit: 3 },
    });
    expect(r.isError).toBeFalsy();
    const rows = JSON.parse((r.content as { text: string }[])[0]?.text ?? "[]");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveProperty("id");
    expect(JSON.stringify(rows)).not.toMatch(/mask/);

    const cats = JSON.parse(
      (
        (await c.callTool({ name: "list_categories", arguments: {} })).content as { text: string }[]
      )[0]?.text ?? "[]",
    ) as { categories: { id: string; name: string }[] }[];
    const coffee = cats.flatMap((g) => g.categories).find((x) => x.name === "Coffee");
    const upd = await c.callTool({
      name: "update_transactions",
      arguments: { ids: [rows[0].id], categoryId: coffee?.id },
    });
    expect(JSON.parse((upd.content as { text: string }[])[0]?.text ?? "{}")).toEqual({ count: 1 });
    const [row] = await withHousehold(t.app, hA, (tx) =>
      tx.select().from(schema.transactions).where(eq(schema.transactions.id, rows[0].id)),
    );
    expect(row?.categoryId).toBe(coffee?.id);
    expect(row?.categorySource).toBe("user");

    const bad = await c.callTool({
      name: "set_budget",
      arguments: { categoryId: coffee?.id, month: "June", amount: 10 },
    });
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.content)).toMatch(/month/);

    const unknown = await c.callTool({ name: "drop_tables", arguments: {} });
    expect(unknown.isError).toBe(true);
    await c.close();
  });

  it("serves the summary resource and prompts", async () => {
    const c = await connect({ scopes: ["read"] });
    const res = await c.readResource({ uri: "mm://household/summary" });
    const summary = JSON.parse((res.contents[0] as { text: string }).text);
    expect(summary).toMatchObject({ household: "Test household", today: "2026-06-30" });
    expect(summary.scopes.map((s: { scope: string }) => s.scope)).toEqual(["read"]);
    const { prompts } = await c.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual([
      "monthly_review",
      "categorize_backlog",
      "refresh_rewards_catalog",
      "optimize_my_wallet",
    ]);
    const p = await c.getPrompt({ name: "monthly_review", arguments: {} });
    expect(JSON.stringify(p.messages)).toMatch(/2026-05/);
    const refresh = await c.getPrompt({
      name: "refresh_rewards_catalog",
      arguments: { olderThanDays: "30", scope: "all" },
    });
    const text = JSON.stringify(refresh.messages);
    expect(text).toMatch(/olderThanDays 30/);
    expect(text).not.toMatch(/walletOnly/);
    expect(text).toMatch(/asOf 2026-06-30/);
    await c.close();
  });
});
