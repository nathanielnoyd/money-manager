"use server";

import { aiBudget, askQuestion, recordAiUsage } from "@mm/ai";
import { todayIso } from "@mm/core";
import { withHousehold } from "@mm/db";
import { z } from "zod";
import { AI_BUDGET_MESSAGE, aiRateLimit, householdAiSettings, serverAi } from "@/lib/ai";
import { financeToolsFor } from "@/lib/ai-tools";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { type ActionResult, principalFor } from "@/lib/household";

const Input = z.object({
  question: z.string().trim().min(2).max(1000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(16),
});

const TOOL_LABEL: Record<string, string> = {
  spending_by_category: "Spending by category",
  spending_by_merchant: "Top merchants",
  monthly_totals: "Monthly totals",
  search_transactions: "Transactions",
  account_balances: "Account balances",
  budget_status: "Budget",
  recurring_charges: "Recurring charges",
  net_worth_history: "Net worth history",
};

/**
 * Answer a question about the household's finances. Question text isn't stored; only
 * token usage is recorded. Each tool call runs in its own short RLS-scoped transaction.
 */
export async function ask(
  input: z.input<typeof Input>,
): Promise<ActionResult<{ answer: string; sources: string[] }>> {
  const s = await requireSession();
  const p = Input.safeParse(input);
  if (!p.success) return { ok: false, error: "Ask a question in a sentence or two." };
  const ai = serverAi();
  if (!ai) return { ok: false, error: "AI isn't configured on this server (ANTHROPIC_API_KEY)." };
  const { settings, budget } = await withHousehold(db(), s.householdId, async (tx) => ({
    settings: await householdAiSettings(tx, s.householdId),
    budget: await aiBudget(tx, s.householdId),
  }));
  if (!settings.enabled)
    return {
      ok: false,
      error:
        "AI features are turned off for this household. An owner can enable them in Settings → AI.",
    };
  if (budget.used >= budget.budget) return { ok: false, error: AI_BUDGET_MESSAGE };
  if (!aiRateLimit(s.householdId))
    return {
      ok: false,
      error: "That's a lot of questions this hour. Please try again a bit later.",
    };

  const scoped = financeToolsFor(principalFor(s));
  try {
    const r = await askQuestion(ai, {
      question: p.data.question,
      history: p.data.history,
      tools: scoped,
      today: todayIso(),
      householdName: s.householdName,
    });
    await withHousehold(db(), s.householdId, (tx) =>
      recordAiUsage(tx, s.householdId, "ask", r.usage),
    );
    return {
      ok: true,
      data: {
        answer: r.answer,
        sources: [...new Set(r.toolCalls.map((c) => TOOL_LABEL[c.name] ?? c.name))],
      },
    };
  } catch (e) {
    console.error("ask failed", (e as Error).message);
    return { ok: false, error: "The AI service didn't respond. Check the API key and try again." };
  }
}
