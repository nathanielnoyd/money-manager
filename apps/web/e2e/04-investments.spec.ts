import { expect, type Page, test } from "@playwright/test";
import { closeOwnerSession, type OwnerSession, openOwnerSession, shot } from "./support";

// Investments, net worth and notifications.
test.describe.configure({ mode: "serial" });

let owner: OwnerSession | undefined;
let page: Page;

test.beforeAll(async ({ browser }) => {
  owner = await openOwnerSession(browser);
  page = owner.page;
});
test.afterAll(() => closeOwnerSession(owner));

test("shows investment performance, allocation and holdings", async () => {
  await page.goto("/investments");
  await expect(page.getByText("Market gain", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: /^VTI/ }).first()).toBeVisible();
  await expect(page.getByText("Stocks", { exact: true })).toBeVisible();
  await expect(page.getByText("Bonds", { exact: true })).toBeVisible();
  await shot(page, "15-investments");
});

test("tracks manual holdings on a manual investment account", async () => {
  await page.goto("/accounts");
  await page.getByRole("button", { name: /Add manual account/ }).click();
  await page.getByLabel("Name").fill("Cold Wallet");
  await page.getByLabel("Type").selectOption("investment");
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText("Net worth over time")).toBeVisible();

  await page.goto("/investments");
  await page.getByRole("button", { name: "Add holding" }).click();
  await page.getByLabel("Account").selectOption({ label: "Cold Wallet" });
  await page.getByLabel("Symbol").fill("BTC");
  await page.getByLabel("Name").fill("Bitcoin");
  await page.getByLabel("Type").selectOption("cryptocurrency");
  await page.getByLabel("Shares").fill("0.25");
  await page.getByLabel("Current value").fill("21,500");
  await page.getByRole("button", { name: "Save holding" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("cell", { name: /^BTC/ }).first()).toBeVisible();
  await expect(page.getByText("Crypto", { exact: true })).toBeVisible();
  await page.goto("/accounts");
  await expect(
    page.locator("li", { hasText: "Cold Wallet" }).getByText("$21,500.00"),
  ).toBeVisible();
});

test("saves notification settings without exposing the access token", async () => {
  await page.goto("/settings/notifications");
  // The SSRF guard refuses destinations on the server's own network.
  await page.getByLabel("Topic URL").fill("https://127.0.0.1:9/mm-e2e-topic");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("private network");
  // A public IP literal passes the guard without needing DNS in CI.
  await page.getByLabel("Topic URL").fill("https://192.0.2.10/mm-e2e-topic");
  await page.getByLabel("Access token (optional)").fill("tk_super_secret_123");
  await page.getByLabel("A transaction is at least ($)").fill("500");
  await page.getByText("A subscription raises its price").click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await page.reload();
  await expect(page.getByLabel("Topic URL")).toHaveValue("https://192.0.2.10/mm-e2e-topic");
  await expect(page.getByLabel("A transaction is at least ($)")).toHaveValue("500");
  expect(await page.content()).not.toContain("tk_super_secret_123");
  await shot(page, "16-notifications");
});
