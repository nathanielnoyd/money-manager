import { safeSendNtfy } from "@mm/connectors";
import { computeAlerts, firstOfMonth, parseNotifySettings } from "@mm/core";
import { type Db, schema, withHousehold } from "@mm/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { log } from "../log";
import { rewardAlerts } from "./reward-reminders";

/**
 * Compute and send alerts for one household. Facts come from the database under RLS;
 * each alert is logged so it is never sent twice. Never throws (alerts mustn't break syncs).
 */
export async function runAlerts(
  db: Db,
  householdId: string,
  since: Date,
  opts: { now?: Date; fetch?: typeof fetch } = {},
): Promise<number> {
  try {
    const now = opts.now ?? new Date();
    const today = now.toISOString().slice(0, 10);
    const pending = await withHousehold(db, householdId, async (tx) => {
      const [h] = await tx
        .select({ n: schema.households.notifications })
        .from(schema.households)
        .where(eq(schema.households.id, householdId));
      const settings = parseNotifySettings(h?.n);
      if (!settings.ntfyUrl) return null;

      const newTransactions = await tx
        .select({
          id: schema.transactions.id,
          amount: schema.transactions.amount,
          pending: schema.transactions.pending,
          raw: schema.transactions.rawDescription,
          merchant: schema.merchants.name,
          account: schema.accounts.name,
        })
        .from(schema.transactions)
        .innerJoin(schema.accounts, eq(schema.accounts.id, schema.transactions.accountId))
        .leftJoin(schema.merchants, eq(schema.merchants.id, schema.transactions.merchantId))
        .where(
          and(
            gte(schema.transactions.createdAt, since),
            sql`${schema.transactions.splitParentId} is null`,
          ),
        );
      const cashAccounts = await tx
        .select({
          id: schema.accounts.id,
          name: schema.accounts.name,
          balance: schema.accounts.currentBalance,
        })
        .from(schema.accounts)
        .where(and(eq(schema.accounts.type, "depository"), eq(schema.accounts.hidden, false)));
      const { rows: increases } = await tx.execute<{
        id: string;
        merchant: string;
        change: string;
        last_amount: string;
        last_date: string;
      }>(sql`
        select r.id, m.name as merchant, r.price_change as change, r.last_amount, r.last_date::text
        from recurring_series r join merchants m on m.id = r.merchant_id
        where r.status = 'active' and r.direction = 'out' and r.price_change < 0 and r.last_date >= ${today}::date - 7`);
      const broken = await tx
        .select({
          id: schema.connections.id,
          institution: schema.connections.institutionName,
          status: schema.connections.status,
          updatedAt: schema.connections.updatedAt,
        })
        .from(schema.connections)
        .where(inArray(schema.connections.status, ["needs_reauth", "error"]));
      const month = firstOfMonth(today);
      const { rows: over } = await tx.execute<{
        category_id: string;
        name: string;
        over: string;
      }>(sql`
        select b.category_id, c.name, (coalesce(sum(-t.amount), 0) - b.amount) as over
        from budget_items b join categories c on c.id = b.category_id
        left join transactions t on t.category_id = b.category_id and not t.excluded and not t.is_split
          and t.date >= ${month}::date and t.date < (${month}::date + interval '1 month')
        where b.month = ${month}::date
        group by b.category_id, c.name, b.amount having coalesce(sum(-t.amount), 0) > b.amount`);

      const alerts = computeAlerts(settings, {
        today,
        newTransactions: newTransactions.map((t) => ({
          id: t.id,
          amount: t.amount,
          pending: t.pending,
          merchant: t.merchant ?? t.raw,
          account: t.account,
        })),
        cashAccounts,
        priceIncreases: increases.map((r) => ({
          id: r.id,
          merchant: r.merchant,
          change: Number(r.change),
          newAmount: Number(r.last_amount),
          lastDate: r.last_date,
        })),
        brokenConnections: broken.map((c) => ({
          id: c.id,
          institution: c.institution,
          status: c.status,
          since: c.updatedAt.toISOString().slice(0, 10),
        })),
        overBudget: over.map((o) => ({
          categoryId: o.category_id,
          category: o.name,
          month,
          over: Number(o.over),
        })),
      });
      if (settings.rewardReminders) {
        // Rewards reminders must never stop other alerts.
        try {
          alerts.push(...(await rewardAlerts(tx, today, settings.includeAmounts !== false)));
        } catch (e) {
          log.warn({ householdId, err: String(e) }, "alerts: rewards reminders failed");
        }
      }
      if (alerts.length === 0) return { settings, fresh: [] };
      const sent = await tx
        .select({ kind: schema.notificationLog.kind, key: schema.notificationLog.key })
        .from(schema.notificationLog)
        .where(
          inArray(
            schema.notificationLog.key,
            alerts.map((a) => a.key),
          ),
        );
      const seen = new Set(sent.map((s) => `${s.kind}|${s.key}`));
      return { settings, fresh: alerts.filter((a) => !seen.has(`${a.kind}|${a.key}`)) };
    });
    if (!pending || pending.fresh.length === 0) return 0;

    let delivered = 0;
    for (const a of pending.fresh.slice(0, 20)) {
      try {
        await safeSendNtfy(pending.settings, a, opts.fetch);
        await withHousehold(db, householdId, (tx) =>
          tx
            .insert(schema.notificationLog)
            .values({ householdId, kind: a.kind, key: a.key })
            .onConflictDoNothing(),
        );
        delivered++;
      } catch (e) {
        log.warn({ householdId, kind: a.kind, err: String(e) }, "alerts: delivery failed");
      }
    }
    log.info({ householdId, delivered }, "alerts: sent");
    return delivered;
  } catch (e) {
    log.error({ householdId, err: String(e) }, "alerts: failed");
    return 0;
  }
}
