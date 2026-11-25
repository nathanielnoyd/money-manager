import { expect, type Page, test } from "@playwright/test";
import { E2E } from "../playwright.config";
import {
  closeOwnerSession,
  MCP_HEADERS,
  type OwnerSession,
  openOwnerSession,
  rpc,
  shot,
} from "./support";

// Agent tokens and the MCP server.
test.describe.configure({ mode: "serial" });

let owner: OwnerSession | undefined;
let page: Page;

test.beforeAll(async ({ browser }) => {
  owner = await openOwnerSession(browser);
  page = owner.page;
});
test.afterAll(() => closeOwnerSession(owner));

test("creates an agent token, uses it over MCP, then revokes it", async ({ request }) => {
  await page.goto("/settings/agents");
  await page.getByLabel("Name", { exact: true }).fill("E2E agent");
  await page.getByLabel("Edit planning").check();
  await page.getByRole("button", { name: "Create token" }).click();
  const token = (await page.getByTestId("copy-token").textContent())?.trim() ?? "";
  expect(token).toMatch(/^mm_pat_[\w-]{43}$/);
  await expect(page.getByTestId("copy-claude-code")).toContainText(
    `claude mcp add --transport http money-manager ${E2E.baseURL}/api/mcp`,
  );
  await shot(page, "20-agents");

  const auth = { ...MCP_HEADERS, authorization: `Bearer ${token}` };
  const init = await request.post("/api/mcp", {
    headers: auth,
    data: rpc("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "e2e", version: "1" },
    }),
  });
  expect(init.status()).toBe(200);
  expect((await init.json()).result.serverInfo.name).toBe("money-manager");

  const list = await request.post("/api/mcp", { headers: auth, data: rpc("tools/list", {}, 2) });
  const names = (await list.json()).result.tools.map((t: { name: string }) => t.name);
  expect(names).toEqual(expect.arrayContaining(["search_transactions", "set_budget"]));

  const call = await request.post("/api/mcp", {
    headers: auth,
    data: rpc(
      "tools/call",
      {
        name: "search_transactions",
        arguments: { text: "netflix", start: "2000-01-01", end: "2100-01-01", limit: 5 },
      },
      3,
    ),
  });
  const found = JSON.parse((await call.json()).result.content[0].text);
  expect(found.length).toBeGreaterThan(0);
  expect(found[0].category).toBe("Subscriptions");

  // The page's own session cookie is not accepted, and neither is a missing or bad token.
  const cookieOnly = await page.request.post("/api/mcp", {
    headers: MCP_HEADERS,
    data: rpc("tools/list"),
  });
  expect(cookieOnly.status()).toBe(401);
  expect(cookieOnly.headers()["www-authenticate"]).toContain("Bearer");
  const bad = await request.post("/api/mcp", {
    headers: { ...MCP_HEADERS, authorization: `Bearer mm_pat_${"x".repeat(43)}` },
    data: rpc("tools/list"),
  });
  expect(bad.status()).toBe(401);
  const xo = await request.post("/api/mcp", {
    headers: { ...auth, origin: "https://evil.example" },
    data: rpc("tools/list"),
  });
  expect(xo.status()).toBe(403);

  // Revoking stops it immediately.
  await page.reload();
  await expect(page.getByText("E2E agent")).toBeVisible();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Revoke E2E agent" }).click();
  await expect(page.getByText("No active tokens.")).toBeVisible();
  const after = await request.post("/api/mcp", { headers: auth, data: rpc("tools/list") });
  expect(after.status()).toBe(401);
});
