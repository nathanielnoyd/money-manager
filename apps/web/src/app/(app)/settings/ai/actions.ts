"use server";

import { MAX_MONTHLY_TOKEN_BUDGET, MIN_MONTHLY_TOKEN_BUDGET, parseAiSettings } from "@mm/ai";
import { schema } from "@mm/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/auth/audit";
import { type ActionResult, inHousehold, requireStepUp } from "@/lib/household";

const Input = z.object({
  enabled: z.boolean(),
  categorize: z.boolean(),
  digest: z.boolean(),
  catalogRefresh: z.boolean().default(false),
  consent: z.boolean(),
  monthlyTokenBudget: z
    .number()
    .int()
    .min(MIN_MONTHLY_TOKEN_BUDGET)
    .max(MAX_MONTHLY_TOKEN_BUDGET)
    .optional(),
});

/** Turning AI on starts sending data to a third party: owner + fresh passkey check. */
export async function saveAiSettings(input: z.input<typeof Input>): Promise<ActionResult> {
  const step = await requireStepUp();
  if ("ok" in step) return step;
  const p = Input.safeParse(input);
  if (!p.success)
    return {
      ok: false,
      error: p.error.issues.some((i) => i.path[0] === "monthlyTokenBudget")
        ? `The monthly limit must be between ${MIN_MONTHLY_TOKEN_BUDGET.toLocaleString("en-US")} and ${MAX_MONTHLY_TOKEN_BUDGET.toLocaleString("en-US")} tokens.`
        : "Invalid settings.",
    };
  const v = p.data;
  const err = await inHousehold(async (tx, s) => {
    const [h] = await tx
      .select({ ai: schema.households.ai })
      .from(schema.households)
      .where(eq(schema.households.id, s.householdId));
    const prev = parseAiSettings(h?.ai);
    if (v.enabled && !prev.consentedAt && !v.consent)
      return "Please confirm you've read what gets shared.";
    const next = {
      enabled: v.enabled,
      categorize: v.enabled && v.categorize,
      digest: v.enabled && v.digest,
      catalogRefresh: v.enabled && v.catalogRefresh,
      consentedAt: v.enabled ? (prev.consentedAt ?? new Date().toISOString()) : undefined,
      monthlyTokenBudget: v.monthlyTokenBudget ?? prev.monthlyTokenBudget,
    };
    await tx
      .update(schema.households)
      .set({ ai: next })
      .where(eq(schema.households.id, s.householdId));
    await audit({
      action: v.enabled ? "ai.enabled" : "ai.disabled",
      userId: s.userId,
      householdId: s.householdId,
      detail: {
        categorize: next.categorize,
        digest: next.digest,
        catalogRefresh: next.catalogRefresh,
        monthlyTokenBudget: next.monthlyTokenBudget,
      },
    });
    return null;
  });
  if (err) return { ok: false, error: err };
  revalidatePath("/", "layout");
  return { ok: true };
}
