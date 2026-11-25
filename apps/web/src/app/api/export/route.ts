import { todayIso } from "@mm/core";
import { withHousehold } from "@mm/db";
import { exportHousehold, exportTransactionsCsv } from "@mm/services";
import { audit } from "@/lib/auth/audit";
import { jsonError } from "@/lib/auth/request";
import { getSession, isRecentlyAuthenticated } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hasRole } from "@/lib/household";

/**
 * Download the household's data: ?format=csv (transactions) or ?format=json (everything).
 * Owner only, and only within minutes of a passkey check: the Settings → Export page does
 * that check, then sends the browser here. Never available to agent tokens.
 */
export async function GET(req: Request) {
  // A plain navigation carries no Origin header; refuse anything a browser marks as cross-site.
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none")
    return jsonError("Cross-origin request blocked", 403);
  const session = await getSession();
  if (!session) return jsonError("Not signed in", 401);
  if (env().demoMode) return jsonError("Not available in the demo.", 403);
  if (!hasRole(session, "owner")) return jsonError("Only the household owner can export.", 403);
  if (!isRecentlyAuthenticated(session)) return jsonError("step_up_required", 403);

  const format = new URL(req.url).searchParams.get("format");
  if (format !== "csv" && format !== "json") return jsonError("Choose csv or json.");
  const body = await withHousehold(db(), session.householdId, async (tx) =>
    format === "csv"
      ? exportTransactionsCsv(tx)
      : JSON.stringify(await exportHousehold(tx, session.householdId), null, 2),
  );
  await audit({
    action: "data.exported",
    userId: session.userId,
    householdId: session.householdId,
    detail: { format },
    req,
  });
  const day = todayIso();
  return new Response(body, {
    headers: {
      "content-type": format === "csv" ? "text/csv; charset=utf-8" : "application/json",
      "content-disposition": `attachment; filename="money-manager-${format === "csv" ? "transactions" : "export"}-${day}.${format}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
