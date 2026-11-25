import { expect, type Page, test } from "@playwright/test";
import {
  closeOwnerSession,
  MCP_HEADERS,
  type OwnerSession,
  openOwnerSession,
  rpc,
  shot,
} from "./support";

// Card rewards, optimization and the agent-maintained catalog.
test.describe.configure({ mode: "serial" });

let owner: OwnerSession | undefined;
let page: Page;

test.beforeAll(async ({ browser }) => {
  owner = await openOwnerSession(browser);
  page = owner.page;
});
test.afterAll(() => closeOwnerSession(owner));

test("links a credit card and shows what its purchases earn", async () => {
  await page.goto("/rewards/wallet");
  const pick = page.getByLabel("Card for Sapphire Preferred");
  await expect(pick).toHaveValue("chase_sapphire_preferred");
  await page.getByRole("button", { name: "Link card to Sapphire Preferred" }).click();
  await expect(page.getByRole("button", { name: "Unlink Sapphire Preferred" })).toBeVisible();
  await expect(page.getByText(/3x dining/).first()).toBeVisible();

  await page.goto("/rewards");
  await expect(page.getByText("Year to date")).toBeVisible();

  // Remap a spending category; the choice sticks.
  await page.goto("/rewards/settings");
  await page.getByLabel("Reward category for Coffee").selectOption("groceries");
  await page.reload();
  await expect(page.getByLabel("Reward category for Coffee")).toHaveValue("groceries");

  await page.goto("/transactions");
  await expect(page.getByTestId("reward-chip").first()).toBeVisible();
  await expect(page.getByTestId("reward-chip").first()).toHaveText(/^[+-][\d.]+(x|%) · /);
});

// ───────────── Phase 8: rewards optimization ─────────────

test("shows which card to use, fee value, bonuses, balances and card ideas", async () => {
  await page.goto("/rewards");
  await expect(page.getByRole("heading", { name: "Which card to use" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Left on the table" })).toBeVisible();

  await page.goto("/rewards/wallet");
  await expect(page.getByText("Annual fee").first()).toBeVisible();
  const credits = page.getByLabel("Credits used per year for Sapphire Preferred");
  await credits.fill("50");
  await credits.blur();
  await page.reload();
  await expect(page.getByLabel("Credits used per year for Sapphire Preferred")).toHaveValue("50");

  await page.getByText("Working on a sign-up bonus?").first().click();
  await page.getByLabel("Bonus points").first().fill("75000");
  await page.getByLabel("Spend ($)").first().fill("5000");
  const deadline = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("By").first().fill(deadline);
  await page.getByRole("button", { name: "Save sign-up bonus for Sapphire Preferred" }).click();
  await expect(page.getByRole("button", { name: "Stop tracking" })).toBeVisible();

  await page.getByLabel("Program").selectOption("chase_ur");
  await page.getByLabel("Balance").fill("80000");
  await page.getByRole("button", { name: "Save balance" }).click();
  await expect(page.getByRole("cell", { name: "80,000" })).toBeVisible();
  await shot(page, "22-rewards-wallet");

  await page.goto("/rewards");
  await expect(
    page.getByRole("progressbar", { name: /Sapphire Preferred sign-up bonus/ }),
  ).toBeVisible();
  await shot(page, "21-rewards");

  await page.goto("/rewards/explore");
  await expect(page.getByRole("heading", { name: "Cards that would pay off" })).toBeVisible();
  await page.getByLabel("Card to simulate").selectOption("amex_gold");
  await expect(page.getByTestId("simulation")).toContainText(
    "American Express Gold Card would add",
  );
  await shot(page, "23-rewards-explore");
});

// ───────────── Phase 9: agent-maintained catalog ─────────────

test("an agent corrects a card with a source; people review, approve and undo", async ({
  request,
}) => {
  await page.goto("/settings/agents");
  await page.getByLabel("Name", { exact: true }).fill("Catalog agent");
  await page.getByLabel("Edit card catalog").check();
  await page.getByRole("button", { name: "Create token" }).click();
  const token = (await page.getByTestId("copy-token").textContent())?.trim() ?? "";
  const auth = { ...MCP_HEADERS, authorization: `Bearer ${token}` };
  const asOf = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const updateFee = async (fee: number, id: number) => {
    const r = await request.post("/api/mcp", {
      headers: auth,
      data: rpc(
        "tools/call",
        {
          name: "update_card",
          arguments: {
            slug: "chase_sapphire_preferred",
            patch: { annualFee: fee },
            sourceUrl: "https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred",
            asOf,
            note: `Annual fee is ${fee} dollars`,
          },
        },
        id,
      ),
    });
    const body = await r.json();
    expect(body.result.isError).toBeFalsy();
    return JSON.parse(body.result.content[0].text) as { status: string };
  };

  const tools = await request.post("/api/mcp", { headers: auth, data: rpc("tools/list") });
  const names = (await tools.json()).result.tools.map((t: { name: string }) => t.name);
  expect(names).toContain("update_card");
  expect(names).not.toContain("review_catalog_change");

  expect((await updateFee(105, 2)).status).toBe("applied");
  await page.goto("/rewards/settings");
  const latest = page.getByTestId("catalog-change").first();
  await expect(latest).toContainText("Changed annual fee: Annual fee is 105 dollars");
  await expect(latest).toContainText("Agent");
  await expect(latest.getByRole("link", { name: "creditcards.chase.com" })).toBeVisible();

  // With approval required, the next agent edit waits for a person.
  const approval = page.getByLabel(
    "Require my approval for changes made by agents and the refresher",
  );
  await approval.check();
  await expect(approval).toBeChecked();
  expect((await updateFee(110, 3)).status).toBe("pending");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Waiting for approval" })).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for approval" })).toBeHidden();
  await expect(page.getByTestId("catalog-change").first()).toContainText(
    "Annual fee is 110 dollars",
  );
  await shot(page, "24-rewards-catalog");

  // Undo the approved change, then reset the card to the shipped values.
  await page.getByRole("button", { name: "Undo change to Sapphire Preferred" }).click();
  await expect(page.getByTestId("catalog-change").first()).toContainText("Undid an earlier change");
  await page.getByRole("button", { name: "Reset Sapphire Preferred" }).click();
  await expect(page.getByRole("heading", { name: "Edited for this household" })).toBeHidden();
  await approval.uncheck();
  await expect(approval).not.toBeChecked();
});
