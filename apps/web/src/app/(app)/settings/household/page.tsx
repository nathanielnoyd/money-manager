import { schema } from "@mm/db";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db";
import { inHousehold } from "@/lib/household";
import { HouseholdView } from "./household-view";

export const metadata = { title: "Household" };

export default async function HouseholdPage() {
  const data = await inHousehold(async (tx, s) => {
    const [household] = await tx
      .select()
      .from(schema.households)
      .where(eq(schema.households.id, s.householdId));
    const invites = await tx
      .select({
        id: schema.invites.id,
        email: schema.invites.email,
        role: schema.invites.role,
        expiresAt: schema.invites.expiresAt,
      })
      .from(schema.invites)
      .where(and(isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())))
      .orderBy(asc(schema.invites.createdAt));
    return { household, invites, me: s };
  });
  const members = await db()
    .select({
      userId: schema.users.id,
      name: schema.users.displayName,
      email: schema.users.email,
      role: schema.householdMembers.role,
      joined: schema.householdMembers.createdAt,
    })
    .from(schema.householdMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.householdMembers.userId))
    .where(eq(schema.householdMembers.householdId, data.me.householdId))
    .orderBy(asc(schema.householdMembers.createdAt));

  return (
    <>
      <PageHeader title="Household" description="Who can see and edit this household's finances." />
      <HouseholdView
        me={{ userId: data.me.userId, role: data.me.role }}
        household={{
          name: data.household?.name ?? "",
          budgetMode: data.household?.budgetMode ?? "flexible",
        }}
        members={members.map((m) => ({ ...m, joined: m.joined.toISOString() }))}
        invites={data.invites.map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString() }))}
      />
    </>
  );
}
