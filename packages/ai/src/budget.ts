import { schema, type Tx } from "@mm/db";
import { eq, gte, sql } from "drizzle-orm";
import { parseAiSettings } from "./settings";

/** Thrown before a model call when the household has used its tokens for the month. */
export class AiBudgetError extends Error {
  constructor(
    public used: number,
    public budget: number,
  ) {
    super("This household has reached its AI token limit for the month.");
  }
}

export interface AiBudget {
  /** Input plus output tokens recorded since the start of the month (UTC). */
  used: number;
  budget: number;
}

/** Tokens used this calendar month against the household's limit (households.ai). */
export async function aiBudget(tx: Tx, householdId: string, now = new Date()): Promise<AiBudget> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [h] = await tx
    .select({ ai: schema.households.ai })
    .from(schema.households)
    .where(eq(schema.households.id, householdId));
  const [u] = await tx
    .select({
      used: sql<string>`coalesce(sum(${schema.aiUsage.inputTokens} + ${schema.aiUsage.outputTokens}), 0)`,
    })
    .from(schema.aiUsage)
    .where(gte(schema.aiUsage.createdAt, monthStart));
  return { used: Number(u?.used ?? 0), budget: parseAiSettings(h?.ai).monthlyTokenBudget };
}

/**
 * Call before every model request, interactive or scheduled. The check is against usage
 * already recorded, so one request can take a household somewhat past its limit; the next is
 * refused.
 */
export async function assertAiBudget(tx: Tx, householdId: string, now = new Date()): Promise<void> {
  const b = await aiBudget(tx, householdId, now);
  if (b.used >= b.budget) throw new AiBudgetError(b.used, b.budget);
}
