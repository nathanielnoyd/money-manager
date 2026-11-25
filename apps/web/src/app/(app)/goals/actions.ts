"use server";

import { schema } from "@mm/db";
import { saveGoal as saveGoalOp } from "@mm/services";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, denyUnless, inHousehold, runOperation } from "@/lib/household";

/** As the goal form sends it: amounts in cents. */
interface GoalInput {
  id?: string;
  name: string;
  targetAmount: number;
  targetDate: string | null;
  accountIds: string[];
  manualAmount: number;
}

const refresh = () => {
  revalidatePath("/goals");
  revalidatePath("/");
};

export async function saveGoal(input: GoalInput): Promise<ActionResult> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  if (!input || typeof input !== "object")
    return { ok: false, error: "Give the goal a name and a target amount." };
  const r = await runOperation(
    saveGoalOp,
    { ...input, targetAmount: input.targetAmount / 100, manualAmount: input.manualAmount / 100 },
    { invalidMessage: "Give the goal a name and a target amount." },
  );
  if (!r.ok) return r;
  refresh();
  return { ok: true };
}

export async function deleteGoal(id: string): Promise<ActionResult> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Invalid goal." };
  await inHousehold((tx) => tx.delete(schema.goals).where(eq(schema.goals.id, id)));
  refresh();
  return { ok: true };
}
