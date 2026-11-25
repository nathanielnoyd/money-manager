import { schema } from "@mm/db";
import { desc, eq, sql } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { env } from "@/lib/env";
import { inHousehold } from "@/lib/household";
import { ConnectionsView } from "./connections-view";

export const metadata = { title: "Connections" };

export default async function ConnectionsPage() {
  const rows = await inHousehold(async (tx) => {
    const conns = await tx
      .select({
        id: schema.connections.id,
        provider: schema.connections.provider,
        institutionName: schema.connections.institutionName,
        status: schema.connections.status,
        lastSyncedAt: schema.connections.lastSyncedAt,
        nextSyncAt: schema.connections.nextSyncAt,
        lastError: schema.connections.lastError,
        accounts: sql<number>`(select count(*)::int from accounts a where a.connection_id = ${schema.connections.id})`,
      })
      .from(schema.connections)
      .orderBy(desc(schema.connections.createdAt));
    const runs = await tx
      .select({
        connectionId: schema.syncRuns.connectionId,
        status: schema.syncRuns.status,
        finishedAt: schema.syncRuns.finishedAt,
      })
      .from(schema.syncRuns)
      .where(eq(schema.syncRuns.status, "running"));
    const running = new Set(runs.map((r) => r.connectionId));
    return conns.map((c) => ({
      ...c,
      syncing: running.has(c.id),
      lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
      nextSyncAt: c.nextSyncAt?.toISOString() ?? null,
    }));
  });
  return (
    <>
      <PageHeader
        title="Connections"
        description="Bank data flows in read-only. Credentials are sealed so only the background worker can use them."
      />
      <ConnectionsView connections={rows} plaidEnabled={!!env().plaid} teller={env().teller} />
    </>
  );
}
