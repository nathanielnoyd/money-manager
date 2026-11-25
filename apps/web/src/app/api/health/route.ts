import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** `/api/health?live` = process is up (liveness). `/api/health` also checks the database (readiness). */
export async function GET(req: Request) {
  if (new URL(req.url).searchParams.has("live")) return Response.json({ ok: true });
  try {
    await db().execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
