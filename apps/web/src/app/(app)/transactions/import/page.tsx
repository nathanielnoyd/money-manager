import { schema } from "@mm/db";
import { asc, desc, eq, sql } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { hasRole, inHousehold } from "@/lib/household";
import { ImportWizard } from "./import-wizard";
import { RecentImports } from "./recent-imports";

export const metadata = { title: "Import" };

export default async function ImportPage() {
  const data = await inHousehold(async (tx, s) => {
    const accounts = await tx
      .select({
        id: schema.accounts.id,
        name: schema.accounts.name,
        type: schema.accounts.type,
        mask: schema.accounts.mask,
        connected: schema.accounts.connectionId,
      })
      .from(schema.accounts)
      .orderBy(asc(schema.accounts.sortOrder));
    const imports = await tx
      .select({
        id: schema.imports.id,
        fileName: schema.imports.fileName,
        account: schema.accounts.name,
        createdAt: schema.imports.createdAt,
        remaining: sql<number>`(select count(*)::int from transactions t where t.import_id = ${schema.imports.id})`,
      })
      .from(schema.imports)
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.imports.accountId))
      .orderBy(desc(schema.imports.createdAt))
      .limit(10);
    return { accounts, imports, canEdit: hasRole(s, "member") };
  });
  return (
    <>
      <PageHeader
        title="Import transactions"
        description="CSV, OFX, QFX or QBO exports from your bank. The file is read in your browser; only the transactions are sent to your server."
      />
      <ImportWizard accounts={data.accounts.map((a) => ({ ...a, connected: !!a.connected }))} />
      <RecentImports
        imports={data.imports.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() }))}
        canEdit={data.canEdit}
      />
    </>
  );
}
