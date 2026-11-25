import { randomBytes } from "node:crypto";
import { addMonths, firstOfMonth, todayIso } from "@mm/core";
import { eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { withHousehold } from "./client";
import { createHousehold } from "./households";
import { refreshRecurring } from "./recurring";
import { appSettings, goals, householdMembers, households, users } from "./schema";
import { seedDemoData } from "./seed";

/**
 * Public demo support (DEMO_MODE=1). A demo instance holds exactly one household of
 * generated data, rebuilt nightly. Visitors get a read-only "viewer" session in it.
 * It refuses to touch a database that contains any other household, so turning
 * DEMO_MODE on by mistake can't expose or damage real data.
 */

const KEY = "demo_household";
const VISITOR_EMAIL = "visitor@demo.invalid";
const OWNER_EMAIL = "alex@demo.invalid";

export class DemoRefusedError extends Error {}

export async function demoHouseholdId(db: Db): Promise<string | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
  return (row?.value as { id?: string } | undefined)?.id ?? null;
}

/** The read-only visitor account sessions are issued to. */
export async function demoVisitor(db: Db): Promise<{ userId: string; householdId: string } | null> {
  const householdId = await demoHouseholdId(db);
  if (!householdId) return null;
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, VISITOR_EMAIL));
  return u ? { userId: u.id, householdId } : null;
}

async function assertDemoOnly(db: Db, demoId: string | null): Promise<void> {
  // households is RLS-protected; count through the membership table, which isn't.
  const { rows } = await db.execute<{ id: string }>(
    sql`select distinct household_id as id from household_members`,
  );
  const others = rows.filter((r) => r.id !== demoId);
  if (others.length > 0) {
    throw new DemoRefusedError(
      "DEMO_MODE is on but this database contains real households. Refusing to touch it: demo mode needs its own database.",
    );
  }
}

/** Delete the previous demo household (if any) and build a fresh one dated to today. */
export async function resetDemo(db: Db, today = todayIso()): Promise<string> {
  const previous = await demoHouseholdId(db);
  await assertDemoOnly(db, previous);

  if (previous) {
    await withHousehold(db, previous, (tx) =>
      tx.delete(households).where(eq(households.id, previous)),
    );
  }
  await db.delete(users).where(sql`${users.email} in (${VISITOR_EMAIL}, ${OWNER_EMAIL})`);

  const [owner] = await db
    .insert(users)
    .values({
      email: OWNER_EMAIL,
      displayName: "Alex Rivera",
      webauthnUserId: randomBytes(32).toString("base64url"),
    })
    .returning();
  const [visitor] = await db
    .insert(users)
    .values({
      email: VISITOR_EMAIL,
      displayName: "Demo visitor",
      webauthnUserId: randomBytes(32).toString("base64url"),
    })
    .returning();
  const householdId = await createHousehold(db, {
    name: "Demo Household",
    ownerUserId: owner?.id as string,
  });
  await db
    .insert(householdMembers)
    .values({ householdId, userId: visitor?.id as string, role: "viewer" });

  await seedDemoData(db, householdId, { months: 12, today: new Date(`${today}T12:00:00Z`) });

  await withHousehold(db, householdId, async (tx) => {
    // A realistic budget: each expense category's 3-month average, rounded up to $5.
    const month = firstOfMonth(today);
    await tx.execute(sql`
      insert into budget_items (household_id, category_id, month, amount)
      select ${householdId}::uuid, t.category_id, ${month}::date, ceil(sum(-t.amount) / 3.0 / 500) * 500
      from transactions t join categories c on c.id = t.category_id join category_groups g on g.id = c.group_id
      where g.kind = 'expense' and t.date >= ${addMonths(month, -3)}::date and t.date < ${month}::date
      group by t.category_id having sum(-t.amount) > 0`);
    const { rows: savings } = await tx.execute<{ id: string }>(
      sql`select id from accounts where name = 'High-Yield Savings'`,
    );
    await tx.insert(goals).values([
      {
        householdId,
        name: "Emergency fund",
        targetAmount: 3_000_000,
        accountIds: savings.map((s) => s.id),
      },
      {
        householdId,
        name: "Japan trip",
        targetAmount: 800_000,
        manualAmount: 310_000,
        targetDate: addMonths(today, 8),
      },
    ]);
    await refreshRecurring(tx, householdId, today);
  });

  await db
    .insert(appSettings)
    .values({ key: KEY, value: { id: householdId } })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: { id: householdId } } });
  return householdId;
}
