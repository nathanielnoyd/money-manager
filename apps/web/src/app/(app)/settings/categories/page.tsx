import { schema } from "@mm/db";
import { asc, sql } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { inHousehold } from "@/lib/household";
import { CategoriesEditor } from "./categories-editor";

export const metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const data = await inHousehold(async (tx) => {
    const groups = await tx
      .select()
      .from(schema.categoryGroups)
      .orderBy(asc(schema.categoryGroups.sortOrder));
    const cats = await tx
      .select({
        id: schema.categories.id,
        groupId: schema.categories.groupId,
        name: schema.categories.name,
        hidden: schema.categories.hidden,
        count: sql<number>`(select count(*)::int from transactions t where t.category_id = ${schema.categories.id})`,
      })
      .from(schema.categories)
      .orderBy(asc(schema.categories.sortOrder), asc(schema.categories.name));
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      kind: g.kind,
      categories: cats.filter((c) => c.groupId === g.id),
    }));
  });
  return (
    <>
      <PageHeader
        title="Categories"
        description="Hidden categories stay on past transactions but disappear from pickers."
      />
      <CategoriesEditor groups={data} />
    </>
  );
}
