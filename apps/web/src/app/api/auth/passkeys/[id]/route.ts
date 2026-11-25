import { schema } from "@mm/db";
import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { audit } from "@/lib/auth/audit";
import { guard } from "@/lib/auth/guard";
import { jsonError } from "@/lib/auth/request";
import { db } from "@/lib/db";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await guard(req, { stepUp: true });
  if (error) return error;
  const { id } = await ctx.params;
  const outcome = await db().transaction(async (tx) => {
    // Lock this user's passkeys so two concurrent deletes can't both pass the "not your last" check.
    const { rows } = await tx.execute<{ id: string }>(
      sql`select id from passkeys where user_id = ${session.userId} for update`,
    );
    if (rows.length <= 1) return "last" as const;
    const deleted = await tx
      .delete(schema.passkeys)
      .where(and(eq(schema.passkeys.id, id), eq(schema.passkeys.userId, session.userId)))
      .returning({ id: schema.passkeys.id });
    return deleted.length === 0 ? ("missing" as const) : ("ok" as const);
  });
  if (outcome === "last") return jsonError("You can't remove your only passkey.");
  if (outcome === "missing") return jsonError("Not found", 404);
  await audit({
    action: "passkey.removed",
    userId: session.userId,
    householdId: session.householdId,
    req,
  });
  return NextResponse.json({ ok: true });
}
