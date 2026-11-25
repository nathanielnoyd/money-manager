"use server";

import { randomToken, sha256Hex } from "@mm/crypto";
import { schema, withHousehold } from "@mm/db";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { type ActionResult, denyUnless, inHousehold, requireStepUp } from "@/lib/household";

const Role = z.enum(["owner", "member", "viewer"]);
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const refresh = () => revalidatePath("/settings/household");

/** Create a single-use invite link. Nothing is emailed: you share the link yourself. */
export async function createInvite(
  email: string,
  role: string,
): Promise<ActionResult<{ url: string }>> {
  const s = await requireStepUp();
  if ("ok" in s) return s;
  const e = z.email().max(254).safeParse(email.trim().toLowerCase());
  const r = Role.safeParse(role);
  if (!e.success || !r.success) return { ok: false, error: "Enter a valid email and role." };
  const [existing] = await db()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, e.data));
  if (existing) return { ok: false, error: "Someone with that email already has an account." };
  const token = randomToken(32);
  await withHousehold(db(), s.householdId, (tx) =>
    tx.insert(schema.invites).values({
      householdId: s.householdId,
      email: e.data,
      role: r.data,
      tokenHash: sha256Hex(token),
      invitedBy: s.userId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    }),
  );
  await audit({
    action: "invite.created",
    userId: s.userId,
    householdId: s.householdId,
    detail: { email: e.data, role: r.data },
  });
  refresh();
  return { ok: true, data: { url: `${env().origin}/invite/${token}` } };
}

export async function revokeInvite(id: string): Promise<ActionResult> {
  const s = await requireStepUp();
  if ("ok" in s) return s;
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Invalid invite." };
  await withHousehold(db(), s.householdId, (tx) =>
    tx.delete(schema.invites).where(eq(schema.invites.id, id)),
  );
  await audit({
    action: "invite.revoked",
    userId: s.userId,
    householdId: s.householdId,
    detail: { id },
  });
  refresh();
  return { ok: true };
}

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/**
 * Lock the household's membership rows for the rest of the transaction, so concurrent role
 * changes and removals are checked against each other (no race to zero owners).
 */
async function lockMembers(tx: Tx, householdId: string) {
  const { rows } = await tx.execute<{ user_id: string; role: string }>(
    sql`select user_id, role from household_members where household_id = ${householdId} for update`,
  );
  return rows;
}

export async function changeRole(userId: string, role: string): Promise<ActionResult> {
  const s = await requireStepUp();
  if ("ok" in s) return s;
  const r = Role.safeParse(role);
  if (!z.uuid().safeParse(userId).success || !r.success)
    return { ok: false, error: "Invalid change." };
  const error = await db().transaction(async (tx) => {
    const members = await lockMembers(tx, s.householdId);
    if (members.find((x) => x.user_id === s.userId)?.role !== "owner")
      return "Only owners can do that.";
    const m = members.find((x) => x.user_id === userId);
    if (!m) return "Member not found.";
    const owners = members.filter((x) => x.role === "owner").length;
    if (m.role === "owner" && r.data !== "owner" && owners <= 1)
      return "A household needs at least one owner.";
    await tx
      .update(schema.householdMembers)
      .set({ role: r.data })
      .where(
        and(
          eq(schema.householdMembers.householdId, s.householdId),
          eq(schema.householdMembers.userId, userId),
        ),
      );
    return null;
  });
  if (error) return { ok: false, error };
  await audit({
    action: "member.role_changed",
    userId: s.userId,
    householdId: s.householdId,
    detail: { member: userId, role: r.data },
  });
  refresh();
  return { ok: true };
}

/** Remove a member: deletes their account, passkeys and sessions (they're signed out immediately). */
export async function removeMember(userId: string): Promise<ActionResult> {
  const s = await requireStepUp();
  if ("ok" in s) return s;
  if (!z.uuid().safeParse(userId).success) return { ok: false, error: "Invalid member." };
  if (userId === s.userId) return { ok: false, error: "You can't remove yourself." };
  const error = await db().transaction(async (tx) => {
    const members = await lockMembers(tx, s.householdId);
    // Re-check under the lock: two owners removing each other at once must not both succeed.
    if (members.find((x) => x.user_id === s.userId)?.role !== "owner")
      return "Only owners can do that.";
    if (!members.some((x) => x.user_id === userId)) return "Member not found.";
    await tx.delete(schema.users).where(eq(schema.users.id, userId));
    return null;
  });
  if (error) return { ok: false, error };
  await audit({
    action: "member.removed",
    userId: s.userId,
    householdId: s.householdId,
    detail: { member: userId },
  });
  refresh();
  return { ok: true };
}

const Settings = z.object({
  name: z.string().trim().min(1).max(80),
  budgetMode: z.enum(["flexible", "zero_based"]),
});

export async function updateHousehold(input: z.input<typeof Settings>): Promise<ActionResult> {
  const denied = await denyUnless("owner");
  if (denied) return denied;
  const p = Settings.safeParse(input);
  if (!p.success) return { ok: false, error: "Enter a name." };
  await inHousehold((tx, s) =>
    tx.update(schema.households).set(p.data).where(eq(schema.households.id, s.householdId)),
  );
  revalidatePath("/", "layout");
  return { ok: true };
}
