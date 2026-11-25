import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import { type Ai, AiRefusedError, type AiUsage, addUsage, UNTRUSTED_TEXT } from "./client";

/**
 * Suggest categories for transactions that rules and merchant defaults didn't cover.
 * Privacy: only the bank's description text and the amount are sent: no account names,
 * numbers, balances, dates or notes.
 */

export interface CategorizeInput {
  categories: { name: string; group: string; kind: "income" | "expense" | "transfer" }[];
  /** A few of this household's own past decisions, as guidance ("STARBUCKS" → Coffee). */
  examples: { description: string; category: string }[];
  transactions: { ref: number; description: string; amount: number }[];
}

export interface CategorySuggestion {
  ref: number;
  category: string | null;
  confidence: "high" | "medium" | "low";
}

const Output = z.object({
  results: z.array(
    z.object({
      ref: z.number().int(),
      category: z.string().nullable(),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
});

const SYSTEM = `You categorize personal bank transactions for a household budgeting app.

For each transaction, choose exactly one category name from the provided list, or null if none fits or you can't tell. Use the household's own examples as the strongest signal for how they like things categorized.

Amounts are in dollars: negative is money out, positive is money in. Credit-card payments and moves between the household's own accounts belong in a transfer category when one exists. Mark confidence "high" only when the merchant and category are unambiguous.

${UNTRUSTED_TEXT}`;

const BATCH = 60;

export async function categorizeTransactions(
  ai: Ai,
  input: CategorizeInput,
): Promise<{ suggestions: CategorySuggestion[]; usage: AiUsage }> {
  const usage: AiUsage = { model: ai.model, inputTokens: 0, outputTokens: 0 };
  const allowed = new Set(input.categories.map((c) => c.name));
  const suggestions: CategorySuggestion[] = [];

  for (let i = 0; i < input.transactions.length; i += BATCH) {
    const batch = input.transactions.slice(i, i + BATCH);
    const payload = {
      categories: input.categories.map((c) => ({ name: c.name, group: c.group, kind: c.kind })),
      examples: input.examples.slice(0, 40),
      transactions: batch.map((t) => ({
        ref: t.ref,
        description: t.description.slice(0, 200),
        amount: t.amount / 100,
      })),
    };
    const res = await ai.client.beta.messages.parse({
      model: ai.model,
      max_tokens: 16000,
      ...ai.extras,
      output_config: { effort: "low", format: betaZodOutputFormat(Output) },
      system: SYSTEM,
      messages: [
        { role: "user", content: `Categorize these transactions.\n\n${JSON.stringify(payload)}` },
      ],
    });
    addUsage(usage, res.usage);
    if (res.stop_reason === "refusal") throw new AiRefusedError(res.stop_details?.category ?? null);
    const parsed = res.parsed_output;
    if (!parsed) continue; // malformed or truncated: leave this batch uncategorized
    const refs = new Set(batch.map((t) => t.ref));
    for (const r of parsed.results) {
      if (!refs.has(r.ref)) continue;
      suggestions.push({
        ref: r.ref,
        category: r.category && allowed.has(r.category) ? r.category : null,
        confidence: r.confidence,
      });
    }
  }
  return { suggestions, usage };
}
