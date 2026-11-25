import { readFileSync } from "node:fs";
import { createPool } from "@mm/db";
import { expect, type Page, test } from "@playwright/test";
import { E2E } from "../playwright.config";
import { closeOwnerSession, type OwnerSession, openOwnerSession, shot } from "./support";

// Import, editing, rules, splits, connections, manual accounts and transactions, export.
test.describe.configure({ mode: "serial" });

let owner: OwnerSession | undefined;
let page: Page;

test.beforeAll(async ({ browser }) => {
  owner = await openOwnerSession(browser);
  page = owner.page;
});
test.afterAll(() => closeOwnerSession(owner));

const CSV = `Posting Date,Description,Amount
03/03/2026,NETFLIX.COM,-15.49
03/04/2026,"SQ *BLUE BOTTLE OAKLAND CA",-6.50
03/05/2026,ACME PAYROLL,2500.00
`;

test("imports a CSV into a new account, and re-importing adds nothing", async () => {
  const importInto = async (target: "new" | "Test Card") => {
    await page.goto("/transactions/import");
    // Pages stream in behind a loading skeleton. A file chosen before the form is interactive
    // is lost (unlike a click, React doesn't replay it), so wait for the page to settle.
    await page.waitForLoadState("networkidle");
    await page
      .locator("#import-file")
      .setInputFiles({ name: "card.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
    await expect(page.getByText("3 transactions", { exact: true })).toBeVisible();
    if (target === "new") {
      await page.getByLabel("Import into").selectOption("new");
      await page.getByLabel("Account name").fill("Test Card");
      await page.getByLabel("Account type").selectOption("credit");
    } else {
      await page.getByLabel("Import into").selectOption({ label: "Test Card" });
    }
    await page.getByRole("button", { name: /^Import 3 transactions$/ }).click();
    await expect(page.getByRole("heading", { name: "Import complete" })).toBeVisible();
  };
  await importInto("new");
  await expect(page.getByText(/Added 3 transactions/)).toBeVisible();
  await importInto("Test Card");
  await expect(page.getByText(/Added 0 transactions; skipped 3/)).toBeVisible();
  await shot(page, "06-import");
});

test("search finds imported transactions with cleaned merchant names", async () => {
  await page.goto("/transactions?q=oakland");
  await expect(page.getByText("1 matching")).toBeVisible();
  await expect(page.getByRole("button", { name: /Blue Bottle/ })).toBeVisible();
  await shot(page, "07-transactions-search");
});

test("categorizing with 'always' creates a rule", async () => {
  await page.goto("/transactions?q=netflix");
  await page
    .getByRole("button", { name: /Netflix/ })
    .first()
    .click();
  await page.getByRole("dialog").getByLabel("Category").selectOption({ label: "Subscriptions" });
  await page.getByText(/Always categorize/).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.goto("/settings/rules");
  await expect(page.getByText(/merchant is “Netflix”/)).toBeVisible();
  await shot(page, "08-rules");
});

test("splits a transaction across two categories", async () => {
  await page.goto("/transactions?q=acme+payroll");
  await page.getByRole("button", { name: /Acme Payroll/i }).click();
  await page.getByRole("button", { name: "Split transaction" }).click();
  await page.getByLabel("Part 1 category").selectOption({ label: "Paycheck" });
  await page.getByLabel("Part 2 category").selectOption({ label: "Other Income" });
  await expect(page.getByText("Balanced")).toBeVisible();
  await page.getByRole("button", { name: "Save split" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText("Paycheck, Other Income")).toBeVisible();
});

test("SimpleFIN linking rejects untrusted hosts and seals valid tokens", async () => {
  await page.goto("/settings/connections");
  const token = (url: string) => Buffer.from(url).toString("base64");
  await page.getByRole("button", { name: /Connect with SimpleFIN/ }).click();
  await page.getByLabel("Setup token").fill(token("https://169.254.169.254/latest/meta-data/iam"));
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText(/isn't allowed/)).toBeVisible();
  await page
    .getByLabel("Setup token")
    .fill(token("https://beta-bridge.simplefin.org/simplefin/claim/E2E-FAKE-TOKEN"));
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText("Linking…")).toBeVisible();

  // The stored credential is sealed: nothing readable in the database.
  const pool = createPool(E2E.adminUrl, 1);
  const { rows } = await pool.query<{ secret_sealed: string }>(
    "select secret_sealed from connections",
  );
  await pool.end();
  expect(rows[0]?.secret_sealed).toMatch(/^v1\./);
  expect(rows[0]?.secret_sealed).not.toContain("E2E-FAKE-TOKEN");
  await shot(page, "09-connections");
});

test("adds a manual account that counts toward net worth", async () => {
  await page.goto("/accounts");
  await page.getByRole("button", { name: /Add manual account/ }).click();
  await page.getByLabel("Name").fill("Vintage Car");
  await page.getByLabel("Type").selectOption("property");
  await page.getByLabel("Current value").fill("18,500");
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText("Vintage Car")).toBeVisible();
  await expect(page.getByText("$18,500.00")).toBeVisible();
});

test("manages categories", async () => {
  await page.goto("/settings");
  for (const name of ["Connections", "Rules", "Categories"]) {
    await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  }
  await page.getByRole("link", { name: /Categories/ }).click();
  await expect(page.getByRole("heading", { name: "Categories" })).toBeVisible();
  const lifestyle = page.locator("div.rounded-xl", {
    has: page.locator('input[value="Lifestyle"]'),
  });
  await lifestyle.getByPlaceholder("New category").fill("Pets");
  await lifestyle.getByRole("button", { name: "Add" }).click();
  await expect(page.locator('input[value="Pets"]')).toBeVisible();
});

test("adds a transaction by hand to a manual account and deletes it again", async () => {
  await page.goto("/transactions");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Account", { exact: true }).selectOption({ label: "Test Card" });
  await dialog.getByLabel("Date", { exact: true }).fill("2026-03-06");
  await dialog.getByLabel("Amount", { exact: true }).fill("18.25");
  await dialog.getByLabel("Description", { exact: true }).fill("CORNER BOOKSHOP");
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(dialog).toBeHidden();

  await page.goto("/transactions?q=corner+bookshop");
  await page.getByRole("button", { name: /Corner Bookshop/i }).click();
  await expect(page.getByRole("dialog").getByText("-$18.25")).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete transaction" }).click();
  await expect(page.getByText("Nothing matches these filters")).toBeVisible();
});

test("removes an import that went into the wrong account", async () => {
  await page.goto("/transactions/import");
  await page.waitForLoadState("networkidle");
  await page.locator("#import-file").setInputFiles({
    name: "oops.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Date,Description,Amount\n04/01/2026,WRONG PLACE ONE,-10.00\n04/02/2026,WRONG PLACE TWO,-20.00\n",
    ),
  });
  await expect(page.getByText("2 transactions", { exact: true })).toBeVisible();
  await page.getByLabel("Import into").selectOption({ label: "Test Card" });
  await page.getByRole("button", { name: /^Import 2 transactions$/ }).click();
  await expect(page.getByRole("heading", { name: "Import complete" })).toBeVisible();

  await page.goto("/transactions/import");
  const row = page.getByRole("listitem").filter({ hasText: "oops.csv" });
  await expect(row).toContainText("2 transactions");
  await row.getByRole("button", { name: "Remove this import" }).click();
  await row.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("Removed 2 transactions.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "oops.csv" })).toHaveCount(0);
  await page.goto("/transactions?q=wrong+place");
  await expect(page.getByText("Nothing matches these filters")).toBeVisible();
  // The earlier import into the same account is untouched.
  await page.goto("/transactions?q=netflix");
  await expect(page.getByRole("button", { name: /Netflix/i }).first()).toBeVisible();
});

test("exports transactions as CSV, for the owner only", async ({ request }) => {
  await page.goto("/settings/export");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Transactions (CSV)" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^money-manager-transactions-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  const csv = readFileSync(await download.path(), "utf8");
  expect(csv.split("\r\n")[0]).toContain("Date,Account,Description,Merchant,Category");
  expect(csv).toContain("NETFLIX.COM");
  const anon = await request.get("/api/export?format=csv");
  expect(anon.status()).toBe(401);
});

test("shows a not-found page inside the app for an unknown address", async () => {
  await page.goto("/no-such-page");
  await expect(page.getByRole("heading", { name: "That page doesn't exist" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to the dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Transactions" }).first()).toBeVisible();
});
