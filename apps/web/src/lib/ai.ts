import "server-only";
import { type Ai, type AiSettings, createAi, parseAiSettings } from "@mm/ai";
import { readSecret, schema, type Tx } from "@mm/db";
import { eq } from "drizzle-orm";
import { env } from "./env";

let cached: Ai | null | undefined;

/**
 * The server's Claude client, or null when no ANTHROPIC_API_KEY is configured. Always null on a
 * public demo, so anonymous visitors can't spend the operator's API budget.
 */
export function serverAi(): Ai | null {
  if (cached !== undefined) return cached;
  const apiKey = env().demoMode ? undefined : readSecret("ANTHROPIC_API_KEY");
  cached = apiKey ? createAi({ apiKey, model: process.env.AI_MODEL }) : null;
  return cached;
}

export async function householdAiSettings(tx: Tx, householdId: string): Promise<AiSettings> {
  const [h] = await tx
    .select({ ai: schema.households.ai })
    .from(schema.households)
    .where(eq(schema.households.id, householdId));
  return parseAiSettings(h?.ai);
}

/** In-memory per-household budget for interactive AI calls (protects your API bill). */
const windows = new Map<string, { count: number; resetAt: number }>();
export function aiRateLimit(householdId: string, limit = 40, windowMs = 60 * 60_000): boolean {
  const now = Date.now();
  const w = windows.get(householdId);
  if (!w || w.resetAt <= now) {
    windows.set(householdId, { count: 1, resetAt: now + windowMs });
    return true;
  }
  w.count += 1;
  return w.count <= limit;
}

export const AI_BUDGET_MESSAGE =
  "This household has used its AI tokens for the month. An owner can raise the limit in Settings → AI.";
