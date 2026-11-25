import { expect, type Page, test } from "@playwright/test";
import {
  addVirtualAuthenticator,
  closeOwnerSession,
  type OwnerSession,
  openOwnerSession,
  shot,
} from "./support";

// Budgets, cash flow, recurring bills, goals and household roles.
test.describe.configure({ mode: "serial" });

let owner: OwnerSession | undefined;
let page: Page;

test.beforeAll(async ({ browser }) => {
  owner = await openOwnerSession(browser);
  page = owner.page;
});
test.afterAll(() => closeOwnerSession(owner));

test("fills a budget from history and saves an edit", async () => {
  await page.goto("/budget");
  await page.getByRole("button", { name: /Fill from 3-month average/ }).click();
  await expect(page.getByText(/Filled \d+ categories/)).toBeVisible();
  const groceries = page.getByLabel("Budget for Groceries");
  await expect(groceries).not.toHaveValue("");
  const coffee = page.getByLabel("Budget for Coffee");
  await coffee.fill("75");
  await coffee.press("Enter");
  await expect(coffee).toHaveValue("75.00");
  await page.reload();
  await expect(page.getByLabel("Budget for Coffee")).toHaveValue("75.00");
  await shot(page, "10-budget");
});

test("shows cash flow with a chart and category breakdown", async () => {
  await page.goto("/cash-flow");
  await expect(page.getByText("Income vs. expenses by month")).toBeVisible();
  await expect(page.locator(".recharts-bar-rectangle").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Groceries" })).toBeVisible();
  await shot(page, "11-cash-flow");
});

test("detects recurring bills and shows upcoming ones on the dashboard", async () => {
  await page.goto("/recurring");
  await expect(page.getByText("Bills & subscriptions").first()).toBeVisible();
  await expect(page.locator("li", { hasText: "Spotify" }).getByText("monthly")).toBeVisible();
  await shot(page, "12-recurring");
  await page.goto("/");
  await expect(page.getByText("Upcoming · 14 days")).toBeVisible();
  await expect(page.getByText("Budget · this month")).toBeVisible();
});

test("tracks a goal against a linked account", async () => {
  await page.goto("/goals");
  await page.getByRole("button", { name: "New goal" }).click();
  await page.getByLabel("Name").fill("Emergency fund");
  await page.getByLabel("Target amount").fill("50,000");
  await page.getByLabel("High-Yield Savings").check();
  await page.getByRole("button", { name: "Save goal" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("progressbar", { name: "Emergency fund progress" })).toBeVisible();
  await expect(page.getByText(/% · \$[\d,.]+ to go/)).toBeVisible();
  await shot(page, "13-goals");
});

test("invites a viewer who can see but not change anything, then removes them", async ({
  browser,
}) => {
  await page.goto("/settings/household");
  await page.getByLabel("Email").fill("viewer@example.test");
  await page.getByLabel("Role", { exact: true }).selectOption("viewer");
  await page.getByRole("button", { name: /Create invite link/ }).click();
  const link = ((await page.getByTestId("invite-link").textContent()) ?? "").trim();
  expect(link).toMatch(/\/invite\/[\w-]{40,}$/);
  await shot(page, "14-household");

  const ctx2 = await browser.newContext();
  const viewer = await ctx2.newPage();
  await addVirtualAuthenticator(viewer);
  await viewer.goto(link);
  await expect(viewer.getByRole("heading", { name: /Join Our Household/ })).toBeVisible();
  await viewer.getByLabel("Your name").fill("Val Viewer");
  await viewer.getByRole("button", { name: /Create passkey/ }).click();
  await viewer.getByLabel(/saved these codes/).check();
  await viewer.getByRole("button", { name: "Continue" }).click();
  await expect(viewer.getByText("You have view-only access to this household.")).toBeVisible();

  // The invite link is single-use.
  const reuse = await ctx2.newPage();
  await reuse.goto(link);
  await expect(reuse.getByRole("heading", { name: "Invite not valid" })).toBeVisible();

  // Viewers can read but every change is refused server-side.
  await viewer.goto("/budget");
  await expect(viewer.getByLabel("Budget for Groceries")).toHaveCount(0);
  await viewer.goto("/transactions?q=netflix");
  await viewer
    .getByRole("button", { name: /Netflix/ })
    .first()
    .click();
  await viewer.getByRole("button", { name: "Save" }).click();
  await expect(viewer.getByRole("alert")).toContainText("view-only");

  // Owner removes the viewer; their session dies immediately.
  await page.reload();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Remove Val Viewer" }).click();
  await expect(page.getByText("viewer@example.test")).toBeHidden();
  await viewer.goto("/");
  await expect(viewer).toHaveURL(/\/login$/);
  await ctx2.close();
});
