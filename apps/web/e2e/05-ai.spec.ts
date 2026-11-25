import { createPool } from "@mm/db";
import { expect, type Page, test } from "@playwright/test";
import { E2E } from "../playwright.config";
import { closeOwnerSession, type OwnerSession, openOwnerSession, shot } from "./support";

// Optional AI features, against the stand-in API in fake-anthropic.ts.
test.describe.configure({ mode: "serial" });

let owner: OwnerSession | undefined;
let page: Page;

test.beforeAll(async ({ browser }) => {
  owner = await openOwnerSession(browser);
  page = owner.page;
});
test.afterAll(() => closeOwnerSession(owner));

test("AI stays off until the owner consents, then can be enabled", async () => {
  await page.goto("/ask");
  await expect(page.getByText("AI is turned off")).toBeVisible();
  await page.goto("/settings/ai");
  await expect(page.getByText("Configured · claude-opus-5-5")).toBeVisible();
  await page.getByText("Enable AI features").click();
  await page.getByText(/Categorize new transactions automatically/).click();
  await page.getByText(/Weekly digest on Monday mornings/).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Please confirm you've read what gets shared.");
  await page.getByText(/I understand what's shared/).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await shot(page, "17-ai-settings");
});

test("answers a question using read-only tools over the household's data", async () => {
  await page.goto("/ask");
  await page.getByRole("button", { name: "How much did we spend on dining last month?" }).click();
  const answer = page.getByTestId("answer");
  await expect(answer).toContainText(/Your biggest category was .+ at \$[\d,]+\.\d{2}/);
  await expect(answer).toContainText("Looked at: Spending by category");
  await shot(page, "18-ask");
});

test("suggests categories for uncategorized transactions and marks them for review", async () => {
  const pool = createPool(E2E.adminUrl, 1);
  const { rows } = await pool.query<{ id: string; household_id: string }>(
    "select id, household_id from accounts where name = 'Everyday Checking'",
  );
  const acct = rows[0] as { id: string; household_id: string };
  await pool.query(
    "insert into transactions (household_id, account_id, date, amount, raw_description) values ($1, $2, current_date, -575, 'SQ *RITUAL COFFEE ROASTERS'), ($1, $2, current_date, -1999, 'ZXQ 4471 MISC')",
    [acct.household_id, acct.id],
  );
  await pool.end();

  await page.goto("/transactions?category=none");
  await page.getByRole("button", { name: "Categorize with AI" }).click();
  await expect(page.getByRole("status")).toContainText(/Categorized [1-9]\d* of \d+/);
  await page.goto("/transactions?q=ritual");
  await expect(
    page.locator("li", { hasText: "Ritual" }).getByText("AI", { exact: true }),
  ).toBeVisible();
  // The category cell holds the name plus the AI badge: "Coffee" + "AI".
  const categoryCell = page
    .locator("li", { hasText: "Ritual" })
    .locator("span", { has: page.getByTitle(/Suggested by AI/) })
    .last();
  await expect(categoryCell).toHaveText("CoffeeAI");
});

test("writes a weekly digest on demand and shows usage", async () => {
  await page.goto("/");
  await page.getByRole("button", { name: "Write this week's digest" }).click();
  await expect(page.getByRole("heading", { name: "A steady week" })).toBeVisible();
  await shot(page, "19-dashboard-digest");
  await page.goto("/settings/ai");
  for (const feature of ["Ask", "Categorization", "Weekly digest"]) {
    await expect(page.getByRole("cell", { name: feature, exact: true })).toBeVisible();
  }
});
