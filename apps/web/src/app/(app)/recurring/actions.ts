"use server";

import { refreshRecurring, schema } from "@mm/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, denyUnless, inHousehold } from "@/lib/household";

const refresh = () => {
  revalidatePath("/recurring");
  revalidatePath("/");
};

/** "This isn't recurring" (or undo). Dismissed series stay dismissed across re-detection. */
export async function setRecurringStatus(
  id: string,
  status: "active" | "dismissed",
): Promise<ActionResult> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  if (!z.uuid().safeParse(id).success || !["active", "dismissed"].includes(status))
    return { ok: false, error: "Invalid change." };
  await inHousehold((tx) =>
    tx.update(schema.recurringSeries).set({ status }).where(eq(schema.recurringSeries.id, id)),
  );
  refresh();
  return { ok: true };
}

export async function rescanRecurring(): Promise<ActionResult<{ found: number }>> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  const found = await inHousehold((tx, s) => refreshRecurring(tx, s.householdId));
  refresh();
  return { ok: true, data: { found } };
}
