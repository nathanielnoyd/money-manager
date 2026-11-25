import { expect, test } from "@playwright/test";
import { E2E } from "../playwright.config";

// API calls without a browser session.

test("cross-origin and unauthenticated API calls are refused", async ({ request }) => {
  const xo = await request.post("/api/auth/login/options", {
    headers: { origin: "https://evil.example" },
  });
  expect(xo.status()).toBe(403);
  const anon = await request.delete("/api/auth/sessions", { headers: { origin: E2E.baseURL } });
  expect(anon.status()).toBe(401);
});
