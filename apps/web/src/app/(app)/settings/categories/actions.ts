"use server";

import { schema } from "@mm/db";
import { createCategory as createCategoryOp } from "@mm/services";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, denyUnless, inHousehold, runOperation } from "@/lib/household";

const Name = z.string().trim().min(1).max(60);
const Id = z.uuid();

function done(): ActionResult {
  revalidatePath("/settings/categories");
  revalidatePath("/transactions");
  return { ok: true };
}

const uniqueError = (e: unknown) =>
  String((e as { cause?: unknown })?.cause ?? e).includes("unique")
    ? "A category with that name already exists."
    : "Couldn't save that change.";

export async function createCategory(groupId: string, name: string): Promise<ActionResult> {
  const r = await runOperation(
    createCategoryOp,
    { groupId, name },
    { invalidMessage: "Enter a name." },
  );
  return r.ok ? done() : r;
}

export async function renameCategory(id: string, name: string): Promise<ActionResult> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  const n = Name.safeParse(name);
  if (!Id.safeParse(id).success || !n.success) return { ok: false, error: "Enter a name." };
  try {
    await inHousehold((tx) =>
      tx.update(schema.categories).set({ name: n.data }).where(eq(schema.categories.id, id)),
    );
  } catch (e) {
    return { ok: false, error: uniqueError(e) };
  }
  return done();
}

export async function setCategoryHidden(id: string, hidden: boolean): Promise<ActionResult> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  if (!Id.safeParse(id).success) return { ok: false, error: "Invalid category." };
  await inHousehold((tx) =>
    tx.update(schema.categories).set({ hidden }).where(eq(schema.categories.id, id)),
  );
  return done();
}

/** Transactions in a deleted category become uncategorized (FK is ON DELETE SET NULL). */
export async function deleteCategory(id: string): Promise<ActionResult> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  if (!Id.safeParse(id).success) return { ok: false, error: "Invalid category." };
  await inHousehold((tx) => tx.delete(schema.categories).where(eq(schema.categories.id, id)));
  return done();
}

export async function createGroup(
  name: string,
  kind: "income" | "expense" | "transfer",
): Promise<ActionResult> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  const n = Name.safeParse(name);
  const k = z.enum(["income", "expense", "transfer"]).safeParse(kind);
  if (!n.success || !k.success) return { ok: false, error: "Enter a name." };
  await inHousehold(async (tx, s) => {
    const { rows } = await tx.execute<{ n: number }>(
      sql`select coalesce(max(sort_order), 0) + 1 as n from category_groups`,
    );
    await tx.insert(schema.categoryGroups).values({
      householdId: s.householdId,
      name: n.data,
      kind: k.data,
      sortOrder: Number(rows[0]?.n ?? 0),
    });
  });
  return done();
}

export async function renameGroup(id: string, name: string): Promise<ActionResult> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  const n = Name.safeParse(name);
  if (!Id.safeParse(id).success || !n.success) return { ok: false, error: "Enter a name." };
  await inHousehold((tx) =>
    tx.update(schema.categoryGroups).set({ name: n.data }).where(eq(schema.categoryGroups.id, id)),
  );
  return done();
}

export async function deleteGroup(id: string): Promise<ActionResult> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  if (!Id.safeParse(id).success) return { ok: false, error: "Invalid group." };
  const err = await inHousehold(async (tx) => {
    const { rows } = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from categories where group_id = ${id}`,
    );
    if ((rows[0]?.n ?? 0) > 0) return "Move or delete this group's categories first.";
    await tx.delete(schema.categoryGroups).where(eq(schema.categoryGroups.id, id));
    return null;
  });
  return err ? { ok: false, error: err } : done();
}
