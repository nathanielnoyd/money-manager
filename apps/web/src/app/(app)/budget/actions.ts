"use server";

import { addMonths } from "@mm/core";
import { schema } from "@mm/db";
import { setBudget as setBudgetOp } from "@mm/services";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, denyUnless, inHousehold, runOperation } from "@/lib/household";
import { getBudgetMonth } from "@/lib/planning";

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/);
const refresh = () => {
  revalidatePath("/budget");
  revalidatePath("/");
};

/** `amount` in cents, as the budget editor sends it. */
export async function setBudget(
  categoryId: string,
  month: string,
  amount: number,
): Promise<ActionResult> {
  if (!Number.isSafeInteger(amount) || amount < 0)
    return { ok: false, error: "Enter a valid amount." };
  const r = await runOperation(
    setBudgetOp,
    { categoryId, month, amount: amount / 100 },
    { invalidMessage: "Enter a valid amount." },
  );
  if (!r.ok) return r;
  refresh();
  return { ok: true };
}

export async function setRollover(categoryId: string, rollover: boolean): Promise<ActionResult> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  if (!z.uuid().safeParse(categoryId).success || typeof rollover !== "boolean")
    return { ok: false, error: "Invalid category." };
  await inHousehold((tx) =>
    tx.update(schema.categories).set({ rollover }).where(eq(schema.categories.id, categoryId)),
  );
  refresh();
  return { ok: true };
}

/** Fill categories that have no budget this month, from last month's budget or from recent spending. */
export async function fillBudget(
  month: string,
  source: "last_month" | "average",
): Promise<ActionResult<{ filled: number }>> {
  const denied = await denyUnless("member");
  if (denied) return denied;
  if (!Month.safeParse(month).success) return { ok: false, error: "Invalid month." };
  if (!z.enum(["last_month", "average"]).safeParse(source).success)
    return { ok: false, error: "Choose last month or your average." };
  const filled = await inHousehold(async (tx, s) => {
    const current = await getBudgetMonth(tx, s.householdId, month);
    const empty = current.expense.filter((l) => l.line.budgeted === 0 && !l.hidden);
    let values: { categoryId: string; amount: number }[];
    if (source === "average") {
      values = empty
        .filter((l) => l.suggested > 0)
        .map((l) => ({ categoryId: l.id, amount: l.suggested }));
    } else {
      const prev = await tx
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.month, addMonths(month, -1)));
      const prevBy = new Map(prev.map((p) => [p.categoryId, p.amount]));
      values = empty.flatMap((l) =>
        prevBy.get(l.id) ? [{ categoryId: l.id, amount: prevBy.get(l.id) as number }] : [],
      );
    }
    if (values.length) {
      await tx
        .insert(schema.budgetItems)
        .values(values.map((v) => ({ ...v, month, householdId: s.householdId })))
        .onConflictDoNothing();
    }
    return values.length;
  });
  refresh();
  return { ok: true, data: { filled } };
}
