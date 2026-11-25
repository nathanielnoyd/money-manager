import "server-only";
import { daysBetween, isLiability, todayIso } from "@mm/core";
import { schema, type Tx } from "@mm/db";
import { asc, eq } from "drizzle-orm";

export async function listGoals(tx: Tx) {
  const goals = await tx
    .select()
    .from(schema.goals)
    .where(eq(schema.goals.archived, false))
    .orderBy(asc(schema.goals.createdAt));
  const accounts = await tx
    .select({
      id: schema.accounts.id,
      name: schema.accounts.name,
      type: schema.accounts.type,
      balance: schema.accounts.currentBalance,
    })
    .from(schema.accounts);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const today = todayIso();
  return {
    accounts: accounts.filter((a) => !isLiability(a.type)).map(({ id, name }) => ({ id, name })),
    goals: goals.map((g) => {
      const linked = g.accountIds.map((id) => byId.get(id)).filter((a) => !!a);
      const current = linked.length
        ? linked.reduce((t, a) => t + (isLiability(a.type) ? -a.balance : a.balance), 0)
        : g.manualAmount;
      const remaining = Math.max(0, g.targetAmount - current);
      const monthsLeft = g.targetDate
        ? Math.max(0, daysBetween(today, g.targetDate) / 30.44)
        : null;
      return {
        id: g.id,
        name: g.name,
        targetAmount: g.targetAmount,
        targetDate: g.targetDate,
        accountIds: g.accountIds,
        manualAmount: g.manualAmount,
        linkedNames: linked.map((a) => a.name),
        current,
        progress: Math.min(1, Math.max(0, current / g.targetAmount)),
        remaining,
        perMonth:
          monthsLeft === null
            ? null
            : monthsLeft < 1
              ? remaining
              : Math.ceil(remaining / monthsLeft),
      };
    }),
  };
}

export type GoalsData = Awaited<ReturnType<typeof listGoals>>;
