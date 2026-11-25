import "server-only";
import { findAnomalies } from "@mm/ai";
import { schema, type Tx } from "@mm/db";
import { desc, eq } from "drizzle-orm";
import { householdAiSettings, serverAi } from "./ai";
import type { Session } from "./auth/session";
import { hasRole } from "./household";

export interface InsightsData {
  anomalies: string[];
  digest: { title: string; summary: string; highlights: string[]; periodStart: string } | null;
  canGenerate: boolean;
}

/** Deterministic findings (always) plus the latest AI digest (when the household uses AI). */
export async function getInsights(tx: Tx, s: Session): Promise<InsightsData> {
  const findings = await findAnomalies(tx);
  const [latest] = await tx
    .select()
    .from(schema.insights)
    .where(eq(schema.insights.kind, "weekly_digest"))
    .orderBy(desc(schema.insights.periodStart))
    .limit(1);
  const body = latest?.body as { summary?: string; highlights?: string[] } | undefined;
  const ai = serverAi() ? await householdAiSettings(tx, s.householdId) : null;
  return {
    anomalies: findings.sentences,
    digest: latest
      ? {
          title: latest.title,
          summary: body?.summary ?? "",
          highlights: body?.highlights ?? [],
          periodStart: latest.periodStart,
        }
      : null,
    canGenerate: !!ai?.enabled && hasRole(s, "member"),
  };
}
