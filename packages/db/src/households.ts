import { DEFAULT_CATEGORY_GROUPS } from "@mm/core";
import { sql } from "drizzle-orm";
import type { Executor, Tx } from "./client";
import { withHousehold } from "./client";
import { categories, categoryGroups, householdMembers, households } from "./schema";

/** Create a household with default categories and add `ownerUserId` as owner. */
export async function createHousehold(
  db: Executor,
  input: { name: string; ownerUserId: string; currency?: string },
): Promise<string> {
  const { rows } = await db.execute<{ id: string }>(sql`select uuidv7() as id`);
  const id = rows[0]?.id;
  if (!id) throw new Error("could not allocate household id");
  await withHousehold(db, id, async (tx) => {
    await tx.insert(households).values({ id, name: input.name, currency: input.currency ?? "USD" });
    await tx
      .insert(householdMembers)
      .values({ householdId: id, userId: input.ownerUserId, role: "owner" });
    await insertDefaultCategories(tx, id);
  });
  return id;
}

export async function insertDefaultCategories(tx: Tx, householdId: string): Promise<void> {
  for (const [gi, group] of DEFAULT_CATEGORY_GROUPS.entries()) {
    const [g] = await tx
      .insert(categoryGroups)
      .values({ householdId, name: group.name, kind: group.kind, sortOrder: gi })
      .returning({ id: categoryGroups.id });
    if (!g) throw new Error("failed to insert category group");
    await tx.insert(categories).values(
      group.categories.map((c, ci) => ({
        householdId,
        groupId: g.id,
        name: c.name,
        icon: c.icon,
        sortOrder: ci,
      })),
    );
  }
}
