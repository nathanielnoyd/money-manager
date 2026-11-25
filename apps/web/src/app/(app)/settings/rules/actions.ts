"use server";

import { schema } from "@mm/db";
import { applyRules, type RuleInput as RuleSchema, saveRule as saveRuleOp } from "@mm/services";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, denyUnless, inHousehold, runOperation } from "@/lib/household";

/** As the rules editor sends it: amount conditions in cents. */
export type RuleInput = Omit<z.input<typeof RuleSchema>, "conditions"> & {
  conditions: (
    | { field: "description" | "merchant"; op: string; value: string }
    | { field: "amount"; op: string; value: number; value2?: number }
    | { field: "direction"; op: "equals"; value: "in" | "out" }
    | { field: "account"; op: "equals"; value: string }
  )[];
};

const refresh = () => {
  revalidatePath("/settings/rules");
  revalidatePath("/transactions");
};

export async function saveRule(input: RuleInput): Promise<ActionResult<{ applied: number }>> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  if (!Array.isArray(input?.conditions)) return { ok: false, error: "Add at least one condition." };
  const conditions = input.conditions.map((c) =>
    c.field === "amount"
      ? {
          ...c,
          value: c.value / 100,
          ...(c.value2 !== undefined ? { value2: c.value2 / 100 } : {}),
        }
      : c,
  );
  const r = await runOperation(saveRuleOp, {
    ...input,
    conditions,
  } as z.input<typeof RuleSchema>);
  if (!r.ok) return r;
  refresh();
  return { ok: true, data: { applied: r.data?.applied ?? 0 } };
}

export async function deleteRule(id: string): Promise<ActionResult> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Invalid rule." };
  await inHousehold((tx) => tx.delete(schema.rules).where(eq(schema.rules.id, id)));
  refresh();
  return { ok: true };
}

export async function toggleRule(id: string, enabled: boolean): Promise<ActionResult> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Invalid rule." };
  await inHousehold((tx) =>
    tx.update(schema.rules).set({ enabled }).where(eq(schema.rules.id, id)),
  );
  refresh();
  return { ok: true };
}

export async function runAllRules(): Promise<ActionResult<{ applied: number }>> {
  const r = await runOperation(applyRules, {});
  if (r.ok) refresh();
  return r;
}
