import "server-only";
import { schema, withHousehold } from "@mm/db";
import { db } from "../db";
import { clientIp } from "./request";

export async function audit(entry: {
  action: string;
  userId?: string | null;
  householdId?: string | null;
  detail?: Record<string, unknown>;
  req?: Request;
}): Promise<void> {
  const row = {
    action: entry.action,
    userId: entry.userId ?? null,
    householdId: entry.householdId ?? null,
    detail: entry.detail ?? null,
    ip: entry.req ? clientIp(entry.req) : null,
    userAgent: entry.req?.headers.get("user-agent")?.slice(0, 300) ?? null,
  };
  if (row.householdId) {
    await withHousehold(db(), row.householdId, (tx) => tx.insert(schema.auditLog).values(row));
  } else {
    await db().insert(schema.auditLog).values(row);
  }
}
