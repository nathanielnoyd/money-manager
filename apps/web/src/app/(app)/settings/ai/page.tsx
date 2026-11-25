import { aiBudget } from "@mm/ai";
import { schema } from "@mm/db";
import { gte, sql } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { householdAiSettings, serverAi } from "@/lib/ai";
import { hasRole, inHousehold } from "@/lib/household";
import { AiSettingsForm } from "./ai-settings-form";

export const metadata = { title: "AI" };

export default async function AiSettingsPage() {
  const ai = serverAi();
  const data = await inHousehold(async (tx, s) => {
    const settings = await householdAiSettings(tx, s.householdId);
    const usage = await tx
      .select({
        feature: schema.aiUsage.feature,
        calls: sql<number>`count(*)::int`,
        input: sql<number>`coalesce(sum(${schema.aiUsage.inputTokens}), 0)::int`,
        output: sql<number>`coalesce(sum(${schema.aiUsage.outputTokens}), 0)::int`,
      })
      .from(schema.aiUsage)
      .where(gte(schema.aiUsage.createdAt, new Date(Date.now() - 30 * 86_400_000)))
      .groupBy(schema.aiUsage.feature);
    const budget = await aiBudget(tx, s.householdId);
    return { settings, usage, budget, isOwner: hasRole(s, "owner") };
  });
  return (
    <>
      <PageHeader
        title="AI"
        description="Optional. Uses your own Anthropic API key; off until an owner turns it on."
      />
      <AiSettingsForm
        configured={!!ai}
        model={ai?.model ?? null}
        settings={{
          enabled: data.settings.enabled,
          categorize: data.settings.categorize,
          digest: data.settings.digest,
          catalogRefresh: data.settings.catalogRefresh,
          consentedAt: data.settings.consentedAt ?? null,
        }}
        usage={data.usage}
        budget={data.budget}
        canEdit={data.isOwner}
      />
    </>
  );
}
