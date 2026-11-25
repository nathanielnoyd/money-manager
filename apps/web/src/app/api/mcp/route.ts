import { schema, withHousehold } from "@mm/db";
import { handleMcpRequest, MAX_BODY_BYTES } from "@mm/mcp";
import { authenticateToken } from "@mm/services";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isLimited, rateLimit } from "@/lib/auth/rate-limit";
import { clientIp } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * MCP server endpoint (Streamable HTTP, stateless, JSON responses). Authenticated only by
 * an agent token in `Authorization: Bearer mm_pat_…`; the session cookie is ignored, so
 * there's no CSRF surface. The access gate in proxy.ts (Tailscale / Cloudflare Access)
 * still applies. See docs/agents.md.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const jsonRpcError = (status: number, message: string, headers: Record<string, string> = {}) =>
  NextResponse.json(
    { jsonrpc: "2.0", error: { code: status === 429 ? -32000 : -32001, message }, id: null },
    { status, headers },
  );

const UNAUTHORIZED = { "WWW-Authenticate": 'Bearer realm="money-manager"' };

export async function POST(req: Request) {
  if (env().demoMode) return jsonRpcError(403, "The MCP server is disabled in the demo.");
  // Browsers always send Origin on cross-site requests; reject any that isn't this app
  // (DNS-rebinding defence, as the MCP spec requires). Agents send no Origin.
  const origin = req.headers.get("origin");
  if (origin && origin !== env().origin) return jsonRpcError(403, "Cross-origin request blocked");

  const ip = clientIp(req);
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return jsonRpcError(401, "Missing agent token", UNAUTHORIZED);
  if (!rateLimit(`mcp-auth:${ip}`, 300, 60_000) || isLimited(`mcp-fail:${ip}`, 20))
    return jsonRpcError(429, "Too many requests");

  const principal = await authenticateToken(db(), token, { ip });
  if (!principal) {
    // Failed attempts are limited separately so tokens can't be guessed quickly.
    rateLimit(`mcp-fail:${ip}`, 20, 15 * 60_000);
    return jsonRpcError(401, "Invalid, expired or revoked agent token", UNAUTHORIZED);
  }
  if (!rateLimit(`mcp:${principal.tokenId}`, 120, 60_000))
    return jsonRpcError(429, "Rate limit: 120 requests per minute per token");

  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return jsonRpcError(413, "Request too large");
  const body = await req.text();
  if (body.length > MAX_BODY_BYTES) return jsonRpcError(413, "Request too large");
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(body);
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null },
      { status: 400 },
    );
  }

  const [household] = await withHousehold(db(), principal.householdId, (tx) =>
    tx
      .select({ name: schema.households.name })
      .from(schema.households)
      .where(eq(schema.households.id, principal.householdId)),
  );
  return handleMcpRequest(
    req,
    {
      db: db(),
      principal,
      householdName: household?.name ?? "Household",
      onError: (operation, e) =>
        console.error(`mcp tool ${operation} failed: ${(e as Error)?.message ?? e}`),
    },
    { parsedBody },
  );
}

// Stateless server: no SSE stream to open and no session to delete.
const notAllowed = () => new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
