import type { RuleCondition } from "@mm/core";
import { schema } from "@mm/db";
import { asc } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { inHousehold } from "@/lib/household";
import { accountOptions, categoryOptions } from "@/lib/transactions";
import { RulesEditor } from "./rules-editor";

export const metadata = { title: "Rules" };

export default async function RulesPage() {
  const data = await inHousehold(async (tx) => ({
    rules: await tx
      .select()
      .from(schema.rules)
      .orderBy(asc(schema.rules.priority), asc(schema.rules.createdAt)),
    categories: await categoryOptions(tx),
    accounts: await accountOptions(tx),
  }));
  return (
    <>
      <PageHeader
        title="Rules"
        description="Rules run on every new transaction, lowest priority number first. The first rule to set a field wins."
      />
      <RulesEditor
        rules={data.rules.map((r) => ({
          id: r.id,
          name: r.name,
          priority: r.priority,
          enabled: r.enabled,
          conditions: r.conditions as RuleCondition[],
          actions: r.actions as Record<string, unknown>,
        }))}
        categories={data.categories}
        accounts={data.accounts}
      />
    </>
  );
}
