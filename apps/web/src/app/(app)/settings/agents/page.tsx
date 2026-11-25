import { listApiTokens, SCOPE_INFO, SCOPES } from "@mm/services";
import { PageHeader } from "@/components/page-header";
import { env } from "@/lib/env";
import { inHousehold } from "@/lib/household";
import { AgentsView } from "./agents-view";

export const metadata = { title: "Agents" };

export default async function AgentsPage() {
  const { tokens, me } = await inHousehold(async (tx, s) => ({
    tokens: await listApiTokens(tx, s),
    me: { userId: s.userId, role: s.role },
  }));
  return (
    <>
      <PageHeader
        title="Agents"
        description="Let an AI agent such as Claude Code work with this household through the MCP server."
      />
      <AgentsView
        endpoint={`${env().origin}/api/mcp`}
        accessMode={env().accessMode}
        demo={env().demoMode}
        me={me}
        scopes={SCOPES.map((s) => ({ id: s, ...SCOPE_INFO[s] }))}
        tokens={tokens.map((t) => ({
          ...t,
          expiresAt: t.expiresAt.toISOString(),
          lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
          createdAt: t.createdAt.toISOString(),
        }))}
      />
    </>
  );
}
