import { readFileSync } from "node:fs";
import { createDb, createPool, seedDemoData } from "@mm/db";
import { expect, type Page, test } from "@playwright/test";
import { E2E } from "../playwright.config";
import { STATE_DIR } from "./global-setup";
import { closeOwnerSession, type OwnerSession, openOwnerSession, shot } from "./support";

// Signing up, signing in and recovery codes. Leaves a signed-in owner and a seeded household.
test.describe.configure({ mode: "serial" });

let owner: OwnerSession | undefined;
let page: Page;
let recoveryCodes: string[] = [];

test.beforeAll(async ({ browser }) => {
  owner = await openOwnerSession(browser, { fresh: true });
  page = owner.page;
});
test.afterAll(() => closeOwnerSession(owner));

test("unauthenticated visitors are sent to setup on a fresh instance", async () => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await shot(page, "01-setup");
  const res = await page.request.get("/login");
  expect(res.headers()["content-security-policy"]).toContain("nonce-");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
});

test("rejects a wrong setup token", async () => {
  await page.getByLabel("Setup token").fill("definitely-not-the-token");
  await page.getByLabel("Your name").fill("Alex Rivera");
  await page.getByLabel("Email").fill("alex@example.test");
  await page.getByRole("button", { name: /create passkey/i }).click();
  await expect(page.getByText(/setup token is invalid or expired/i)).toBeVisible();
});

test("first-run setup creates the owner with a passkey and shows recovery codes", async () => {
  await page.getByLabel("Setup token").fill(readFileSync(`${STATE_DIR}/setup-token`, "utf8"));
  await page.getByRole("button", { name: /create passkey/i }).click();
  await expect(page.getByRole("heading", { name: /save your recovery codes/i })).toBeVisible();
  recoveryCodes = await page.locator("ol li").allInnerTexts();
  expect(recoveryCodes).toHaveLength(10);
  const cont = page.getByRole("button", { name: /continue to dashboard/i });
  await expect(cont).toBeDisabled();
  await page.getByLabel(/saved these codes/i).check();
  await cont.click();
  await expect(
    page.getByRole("heading", { name: /good (morning|afternoon|evening), alex/i }),
  ).toBeVisible();
  await expect(page.getByText("No accounts yet")).toBeVisible();
});

test("setup cannot be repeated", async () => {
  await page.goto("/setup");
  await expect(page).not.toHaveURL(/\/setup$/);
  const res = await page.request.post("/api/auth/setup/options", {
    headers: { origin: E2E.baseURL },
    data: {
      setupToken: "x".repeat(20),
      email: "evil@example.test",
      displayName: "E",
      householdName: "H",
    },
  });
  expect(res.status()).toBe(409);
});

test("dashboard shows seeded data scoped to the household", async () => {
  const pool = createPool(E2E.adminUrl, 1);
  const { rows } = await pool.query<{ id: string }>("select id from households limit 1");
  await seedDemoData(createDb(pool), rows[0]?.id as string, { months: 6 });
  await pool.end();
  await page.reload();
  await expect(page.getByText("Net worth").first()).toBeVisible();
  await expect(page.getByText("Everyday Checking").first()).toBeVisible();
  await shot(page, "02-dashboard");
  await page.goto("/transactions");
  await expect(page.locator("ul li").first()).toBeVisible();
  await shot(page, "03-transactions");
  await page.goto("/accounts");
  await shot(page, "04-accounts");
});

test("sign out, then sign back in with the passkey", async () => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/accounts");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("button", { name: /sign in with passkey/i }).click();
  await expect(page.getByRole("heading", { name: /good .*alex/i })).toBeVisible();
});

test("security page lists the passkey and the session", async () => {
  await page.goto("/settings/security");
  await expect(page.getByText("First passkey")).toBeVisible();
  await expect(page.getByText("This device")).toBeVisible();
  await expect(page.getByText("10 left")).toBeVisible();
  await shot(page, "05-security");
});

test("recovery codes work exactly once", async () => {
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/login/recovery");
  await page.getByLabel("Email").fill("ALEX@example.test");
  await page.getByLabel("Recovery code").fill((recoveryCodes[0] as string).toLowerCase());
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/settings\/security\?recovered=1$/);
  await expect(page.getByText(/signed in with a recovery code/i)).toBeVisible();
  await expect(page.getByText("9 left")).toBeVisible();

  const reuse = await page.request.post("/api/auth/recovery", {
    headers: { origin: E2E.baseURL },
    data: { email: "alex@example.test", code: recoveryCodes[0] },
  });
  expect(reuse.status()).toBe(401);

  // A recovery session never counts as a recent passkey check, so it can't do owner-level
  // sensitive actions (here: starting TOTP setup) beyond enrolling a new passkey.
  const totp = await page.request.post("/api/auth/totp/setup", {
    headers: { origin: E2E.baseURL },
  });
  expect(totp.status()).toBe(403);

  // Back to a full-strength session for the rest of the suite.
  await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("button", { name: /sign in with passkey/i }).click();
  await expect(page.getByRole("heading", { name: /good .*alex/i })).toBeVisible();
});
