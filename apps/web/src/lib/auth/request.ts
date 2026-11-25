import "server-only";
import { NextResponse } from "next/server";
import { env } from "../env";

/**
 * The client's IP for rate limits and the audit log, from headers only the trusted proxy
 * can set. A client can send its own X-Forwarded-For, but the proxy (tailscale serve) appends
 * the real peer address, so we take the right-most entry. Cf-Connecting-IP is trusted only
 * behind Cloudflare, where Cloudflare overwrites it.
 */
export function clientIp(req: Request): string {
  if (env().accessMode === "cloudflare") {
    const cf = req.headers.get("cf-connecting-ip")?.trim();
    if (cf) return cf;
  }
  const hops =
    req.headers
      .get("x-forwarded-for")
      ?.split(",")
      .map((h) => h.trim())
      .filter(Boolean) ?? [];
  return hops[hops.length - 1] ?? "unknown";
}

/** CSRF defence for JSON endpoints: require a same-origin Origin header. */
export function assertSameOrigin(req: Request): NextResponse | null {
  const origin = req.headers.get("origin");
  if (origin !== env().origin) {
    return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
  }
  return null;
}

export const jsonError = (error: string, status = 400) => NextResponse.json({ error }, { status });
