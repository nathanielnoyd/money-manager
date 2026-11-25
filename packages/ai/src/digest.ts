import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import { type Ai, AiRefusedError, type AiUsage, addUsage, UNTRUSTED_TEXT } from "./client";

/**
 * Turn a week's computed facts into a short, friendly digest. The facts are aggregates
 * the app already calculated; the model only writes prose around them.
 */

export interface DigestFacts {
  weekStart: string;
  weekEnd: string;
  spent: number;
  typicalWeeklySpend: number;
  income: number;
  topCategories: { category: string; spent: number }[];
  largestTransactions: { merchant: string; amount: number; date: string }[];
  anomalies: string[];
  upcomingBills: { merchant: string; amount: number; date: string }[];
  budget: { budgeted: number; spent: number; overCategories: string[] } | null;
}

const Output = z.object({
  title: z.string().describe("At most 8 words"),
  summary: z.string().describe("Two or three sentences"),
  highlights: z.array(z.string()).describe("Three to five short bullet points"),
});

export type Digest = z.infer<typeof Output>;

const SYSTEM = `You write a weekly money digest for a household, from facts computed by their budgeting app.

Be warm, plain-spoken and specific. Use the figures provided (US dollars, already rounded) and never invent numbers or transactions. Compare the week with their typical week. Mention unusual items and anything due soon. No advice about investments, taxes or legal matters, and no lecturing.

${UNTRUSTED_TEXT}`;

export async function writeDigest(
  ai: Ai,
  facts: DigestFacts,
): Promise<{ digest: Digest; usage: AiUsage }> {
  const usage: AiUsage = { model: ai.model, inputTokens: 0, outputTokens: 0 };
  const res = await ai.client.beta.messages.parse({
    model: ai.model,
    max_tokens: 16000,
    ...ai.extras,
    output_config: { effort: "low", format: betaZodOutputFormat(Output) },
    system: SYSTEM,
    messages: [{ role: "user", content: `Write this week's digest.\n\n${JSON.stringify(facts)}` }],
  });
  addUsage(usage, res.usage);
  if (res.stop_reason === "refusal") throw new AiRefusedError(res.stop_details?.category ?? null);
  if (!res.parsed_output) throw new Error("The digest response couldn't be parsed.");
  return { digest: res.parsed_output, usage };
}
