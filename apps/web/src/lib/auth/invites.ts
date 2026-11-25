import "server-only";
import { sha256Hex } from "@mm/crypto";
import type { Executor } from "@mm/db";
import { sql } from "drizzle-orm";

export type InviteRow = {
  id: string;
  household_id: string;
  email: string;
  role: "owner" | "member" | "viewer";
  expires_at: Date;
  accepted_at: Date | null;
};

/** Look up a pending invite by its secret token (via the SECURITY DEFINER find_invite). */
export async function findValidInvite(db: Executor, token: string): Promise<InviteRow | null> {
  if (!/^[\w-]{20,100}$/.test(token)) return null;
  return findValidInviteByHash(db, sha256Hex(token));
}

/** The token's sha256, safe to keep in short-lived server state instead of the token. */
export const inviteTokenHash = (token: string): string => sha256Hex(token);

/** Like findValidInvite, for a hash from inviteTokenHash. */
export async function findValidInviteByHash(db: Executor, hash: string): Promise<InviteRow | null> {
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  const { rows } = await db.execute<InviteRow>(sql`select * from find_invite(${hash})`);
  const inv = rows[0];
  if (!inv || inv.accepted_at || new Date(inv.expires_at).getTime() < Date.now()) return null;
  return inv;
}
