import type Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import { type Ai, type AiUsage, addUsage, UNTRUSTED_TEXT } from "./client";

/**
 * Natural-language questions about the household's money. Claude never sees a dump of
 * the data: it calls narrow, read-only tools whose answers the app computes in SQL
 * under row-level security, and it sees only those aggregates and small result sets.
 */

const DateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD");

/** Implemented by the app (web) against the database; all amounts in dollars. */
export interface FinanceTools {
  spendingByCategory(a: { start: string; end: string }): Promise<unknown>;
  spendingByMerchant(a: { start: string; end: string; limit: number }): Promise<unknown>;
  monthlyTotals(a: { start: string; end: string }): Promise<unknown>;
  searchTransactions(a: {
    text?: string;
    category?: string;
    start: string;
    end: string;
    minAmount?: number;
    limit: number;
  }): Promise<unknown>;
  accountBalances(): Promise<unknown>;
  budgetStatus(a: { month: string }): Promise<unknown>;
  recurringCharges(): Promise<unknown>;
  netWorthHistory(a: { start: string; end: string }): Promise<unknown>;
}

export interface AskInput {
  question: string;
  /** Earlier turns of this conversation (text only). */
  history?: { role: "user" | "assistant"; content: string }[];
  tools: FinanceTools;
  today: string;
  householdName: string;
}

export interface AskResult {
  answer: string;
  toolCalls: { name: string; input: unknown }[];
  usage: AiUsage;
  refused: boolean;
}

const MAX_TOOL_RESULT = 20_000;

/**
 * Serialize a tool result for the model, always as valid JSON. A long list is cut to the rows
 * that fit and says so; anything else too large becomes an error the model can act on.
 */
export function toolResultJson(v: unknown): string {
  const s = JSON.stringify(v) ?? "null";
  if (s.length <= MAX_TOOL_RESULT) return s;
  if (Array.isArray(v)) {
    let shown = v.length;
    let rows = "";
    do {
      shown = Math.floor(shown / 2);
      rows = JSON.stringify(v.slice(0, shown));
    } while (shown > 0 && rows.length > MAX_TOOL_RESULT - 200);
    return `{"truncated":true,"shown":${shown},"total":${v.length},"rows":${rows}}`;
  }
  return JSON.stringify({
    error: "That result is too large to read. Ask for a shorter date range or fewer rows.",
  });
}
const json = toolResultJson;

export function financeTools(t: FinanceTools, record: (name: string, input: unknown) => void) {
  const wrap =
    <I>(name: string, fn: (i: I) => Promise<unknown>) =>
    async (input: I) => {
      record(name, input);
      try {
        return json(await fn(input));
      } catch (e) {
        return json({ error: (e as Error).message });
      }
    };
  return [
    betaZodTool({
      name: "spending_by_category",
      description:
        "Total spending per category between two dates (inclusive). Excludes transfers and excluded transactions. Use for 'how much did we spend on X'.",
      inputSchema: z.object({ start: DateStr, end: DateStr }),
      run: wrap("spending_by_category", (i) => t.spendingByCategory(i)),
    }),
    betaZodTool({
      name: "spending_by_merchant",
      description: "Top merchants by spending between two dates, with transaction counts.",
      inputSchema: z.object({
        start: DateStr,
        end: DateStr,
        limit: z.number().int().min(1).max(25).default(10),
      }),
      run: wrap("spending_by_merchant", (i) => t.spendingByMerchant(i)),
    }),
    betaZodTool({
      name: "monthly_totals",
      description:
        "Income, expenses and net per calendar month between two dates. Use for trends and comparisons over time.",
      inputSchema: z.object({ start: DateStr, end: DateStr }),
      run: wrap("monthly_totals", (i) => t.monthlyTotals(i)),
    }),
    betaZodTool({
      name: "search_transactions",
      description:
        "Find individual transactions by text (merchant or description), category name, date range and minimum absolute amount. Returns at most `limit` rows, newest first.",
      inputSchema: z.object({
        text: z.string().max(80).optional(),
        category: z.string().max(60).optional(),
        start: DateStr,
        end: DateStr,
        minAmount: z.number().min(0).optional().describe("Minimum absolute amount in dollars"),
        limit: z.number().int().min(1).max(25).default(10),
      }),
      run: wrap("search_transactions", (i) => t.searchTransactions(i)),
    }),
    betaZodTool({
      name: "account_balances",
      description:
        "Current balance of every account (liabilities shown as amounts owed) and total net worth.",
      inputSchema: z.object({}),
      run: wrap("account_balances", () => t.accountBalances()),
    }),
    betaZodTool({
      name: "budget_status",
      description: "Budgeted vs spent per category for a month (YYYY-MM-01).",
      inputSchema: z.object({ month: DateStr }),
      run: wrap("budget_status", (i) => t.budgetStatus(i)),
    }),
    betaZodTool({
      name: "recurring_charges",
      description:
        "Detected subscriptions, bills and regular income with cadence, typical amount and next expected date.",
      inputSchema: z.object({}),
      run: wrap("recurring_charges", () => t.recurringCharges()),
    }),
    betaZodTool({
      name: "net_worth_history",
      description:
        "Net worth, assets and liabilities at the start of each month between two dates.",
      inputSchema: z.object({ start: DateStr, end: DateStr }),
      run: wrap("net_worth_history", (i) => t.netWorthHistory(i)),
    }),
  ];
}

const system = (
  today: string,
  household: string,
) => `You answer questions about the "${household}" household's own finances inside a private, self-hosted money app.

Today is ${today}. Use the tools to look up facts. Never guess numbers: if the tools can't answer, say what you'd need. Amounts from tools are in US dollars; spending is reported as positive numbers.

Answer in a few short sentences or a compact markdown list or table. Lead with the direct answer, include the specific figures and the date range you used, and mention notable context only when it helps. Don't give investment, tax or legal advice; you can describe what the data shows.

${UNTRUSTED_TEXT}`;

export async function askQuestion(ai: Ai, input: AskInput): Promise<AskResult> {
  const usage: AiUsage = { model: ai.model, inputTokens: 0, outputTokens: 0 };
  const toolCalls: AskResult["toolCalls"] = [];
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...(input.history ?? []).slice(-8).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.question.slice(0, 2000) },
  ];
  const runner = ai.client.beta.messages.toolRunner({
    model: ai.model,
    max_tokens: 16000,
    max_iterations: 8,
    ...ai.extras,
    output_config: { effort: "medium" },
    system: system(input.today, input.householdName),
    tools: financeTools(input.tools, (name, i) => toolCalls.push({ name, input: i })),
    messages,
  });
  let last: Anthropic.Beta.BetaMessage | undefined;
  for await (const message of runner) {
    addUsage(usage, message.usage);
    last = message;
  }
  if (!last || last.stop_reason === "refusal") {
    return {
      answer:
        "I can't help with that one. Try asking about your spending, budgets, accounts or recurring bills.",
      toolCalls,
      usage,
      refused: true,
    };
  }
  const answer = last.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  // The runner stops after max_iterations even if the model was still calling tools, and a
  // reply can run out of tokens. Say so, rather than present a partial answer as the answer.
  if (last.stop_reason === "tool_use") {
    return {
      answer:
        "I couldn't finish looking that up in the steps I'm allowed. Try a narrower question, such as one month or one category.",
      toolCalls,
      usage,
      refused: false,
    };
  }
  const cutShort = last.stop_reason === "max_tokens";
  return {
    answer: answer
      ? `${answer}${cutShort ? "\n\n(This answer was cut short. Ask a narrower question for the rest.)" : ""}`
      : "I couldn't find an answer in your data.",
    toolCalls,
    usage,
    refused: false,
  };
}
