import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Browser, BrowserContext, CDPSession, Page } from "@playwright/test";
import { STATE_DIR } from "./global-setup";

/**
 * Shared set-up for the end-to-end specs. The specs run in file order (01-…, 02-…) in one
 * worker and build on each other's data: 01 creates the owner and seeds a household, later
 * files use it. Each file opens the owner's session from where the previous one left it (the
 * session cookie and the passkey in the virtual authenticator), so sign-in and passkey
 * step-up keep working, and saves it again at the end.
 */

const AUTH_STATE = `${STATE_DIR}/owner-state.json`;
const PASSKEYS = `${STATE_DIR}/owner-passkeys.json`;

/** Chrome's virtual authenticator acts as a platform passkey (Touch ID / Windows Hello). */
export async function addVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

/** Optional design-review captures: SCREENSHOT_DIR=/tmp/shots pnpm test:e2e */
export async function shot(p: Page, name: string) {
  const dir = process.env.SCREENSHOT_DIR;
  if (!dir) return;
  for (const scheme of ["light", "dark"] as const) {
    await p.emulateMedia({ colorScheme: scheme });
    await p.evaluate(() => localStorage.removeItem("mm-theme"));
    await p.reload();
    await p.waitForLoadState("networkidle");
    await p.screenshot({ path: `${dir}/${name}-${scheme}.png`, fullPage: true });
  }
  await p.emulateMedia({ colorScheme: "light" });
}

export interface OwnerSession {
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  authenticatorId: string;
}

/** The owner's browser. `fresh` starts signed out with an empty authenticator (01 only). */
export async function openOwnerSession(
  browser: Browser,
  opts: { fresh?: boolean } = {},
): Promise<OwnerSession> {
  if (!opts.fresh && !existsSync(AUTH_STATE))
    throw new Error("No saved owner session: run the specs from 01-auth.spec.ts.");
  const context = await browser.newContext({
    viewport: { width: 1360, height: 900 },
    ...(opts.fresh ? {} : { storageState: AUTH_STATE }),
  });
  const page = await context.newPage();
  // Surface browser-side crashes in the test output.
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.stack ?? e.message}`));
  const { cdp, authenticatorId } = await addVirtualAuthenticator(page);
  if (!opts.fresh) {
    for (const credential of JSON.parse(readFileSync(PASSKEYS, "utf8")))
      await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });
  }
  return { context, page, cdp, authenticatorId };
}

/** Save the session and the passkey (with its current signature counter) for the next file. */
export async function closeOwnerSession(s: OwnerSession | undefined) {
  if (!s) return;
  const { credentials } = await s.cdp.send("WebAuthn.getCredentials", {
    authenticatorId: s.authenticatorId,
  });
  if (credentials.length) writeFileSync(PASSKEYS, JSON.stringify(credentials));
  await s.context.storageState({ path: AUTH_STATE });
  await s.context.close();
}

/** A JSON-RPC request body for the MCP endpoint. */
export const rpc = (method: string, params: Record<string, unknown> = {}, id = 1) => ({
  jsonrpc: "2.0",
  id,
  method,
  params,
});

/** Streamable HTTP clients must accept both JSON and server-sent events. */
export const MCP_HEADERS = { accept: "application/json, text/event-stream" };
