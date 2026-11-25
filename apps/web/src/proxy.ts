import { type NextRequest, NextResponse } from "next/server";
import { type AccessMode, createAccessGate, isGateExempt, isPublicPath } from "@/lib/access-gate";

/**
 * Runs before every request:
 * 1. Access gate (defence in depth behind Tailscale / Cloudflare Access).
 * 2. Redirect to /login when there is no session cookie (the session itself is
 *    validated server-side on every page and API call).
 * 3. Per-request CSP nonce.
 */

const accessMode = (process.env.ACCESS_MODE ?? "none") as AccessMode;
const tsAllowed = (process.env.TAILSCALE_ALLOWED_USERS ?? "").split(",");
if (
  accessMode === "tailscale" &&
  !tsAllowed.some((s) => s.trim()) &&
  process.env.NODE_ENV === "production"
) {
  console.warn(
    "ACCESS_MODE=tailscale without TAILSCALE_ALLOWED_USERS: the app relies only on network isolation (anyone on your tailnet who can reach this node gets the login page). Set TAILSCALE_ALLOWED_USERS for defence in depth.",
  );
}
const gate = createAccessGate({
  mode: accessMode,
  tailscaleAllowed: tsAllowed,
  cfTeamDomain: process.env.CF_ACCESS_TEAM_DOMAIN,
  cfAudience: process.env.CF_ACCESS_AUD,
});

const httpsOrigin = (process.env.APP_URL ?? "").startsWith("https://");

function contentSecurityPolicy(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "frame-ancestors 'none'",
    // Plaid Link runs in an iframe from Plaid's CDN; only allowed when Plaid is configured.
    `frame-src ${
      [
        process.env.PLAID_CLIENT_ID ? "https://cdn.plaid.com" : "",
        process.env.TELLER_APPLICATION_ID ? "https://teller.io https://*.teller.io" : "",
      ]
        .filter(Boolean)
        .join(" ") || "'none'"
    }`,
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(httpsOrigin ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!isGateExempt(pathname) && !(await gate.passes(req.headers))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const isPublic = isPublicPath(pathname);
  const hasSession = req.cookies.has("__Host-mm_session") || req.cookies.has("mm_session");
  if (!isPublic && !hasSession) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV !== "production");
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("content-security-policy", csp);
  res.headers.set("cache-control", "no-store");
  return res;
}

export const config = {
  matcher: [
    {
      // No `missing: next-router-prefetch` exclusion: a client could add that header to skip
      // the access gate entirely. The gate is cheap, so it runs on every request.
      source: "/((?!_next/static|_next/image|favicon.ico|icon.svg).*)",
    },
  ],
};
