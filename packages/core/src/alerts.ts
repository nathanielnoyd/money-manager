import { formatMoney } from "./money";

/**
 * Decide which alerts to send. Pure: the worker supplies facts, this returns messages.
 * Every alert has a stable `key` so it is sent at most once (see notification_log).
 */

export interface AlertSettings {
  /** Absolute amount in minor units; unset = off. */
  largeTransaction?: number;
  /** Cash-account balance floor in minor units; unset = off. */
  lowBalance?: number;
  priceIncreases?: boolean;
  syncProblems?: boolean;
  budgetOverspend?: boolean;
  /** Card rewards reminders: rotating activation, caps, sign-up bonus deadlines, annual fees. */
  rewardReminders?: boolean;
  /** When false, messages say what happened without amounts or balances. */
  includeAmounts?: boolean;
}

export interface AlertFacts {
  today: string;
  newTransactions: {
    id: string;
    amount: number;
    merchant: string;
    account: string;
    pending: boolean;
  }[];
  cashAccounts: { id: string; name: string; balance: number }[];
  priceIncreases: {
    id: string;
    merchant: string;
    change: number;
    newAmount: number;
    lastDate: string;
  }[];
  brokenConnections: { id: string; institution: string; status: string; since: string }[];
  overBudget: { categoryId: string; category: string; month: string; over: number }[];
}

export interface Alert {
  kind:
    | "large_transaction"
    | "low_balance"
    | "price_increase"
    | "sync_problem"
    | "budget_over"
    | "rewards";
  key: string;
  title: string;
  body: string;
  priority: "default" | "high";
}

export function computeAlerts(s: AlertSettings, f: AlertFacts): Alert[] {
  const money = (m: number) => (s.includeAmounts === false ? "" : formatMoney(Math.abs(m)));
  const out: Alert[] = [];

  if (s.largeTransaction && s.largeTransaction > 0) {
    for (const t of f.newTransactions) {
      if (t.pending || Math.abs(t.amount) < s.largeTransaction) continue;
      const dir = t.amount < 0 ? "Large charge" : "Large deposit";
      out.push({
        kind: "large_transaction",
        key: t.id,
        title: dir,
        body: `${money(t.amount)} ${t.amount < 0 ? "at" : "from"} ${t.merchant} · ${t.account}`.trim(),
        priority: "default",
      });
    }
  }
  if (s.lowBalance !== undefined && s.lowBalance > 0) {
    for (const a of f.cashAccounts) {
      if (a.balance >= s.lowBalance) continue;
      out.push({
        kind: "low_balance",
        key: `${a.id}:${f.today}`,
        title: "Low balance",
        body:
          s.includeAmounts === false
            ? `${a.name} is below your threshold`
            : `${a.name} is at ${formatMoney(a.balance)}`,
        priority: "high",
      });
    }
  }
  if (s.priceIncreases) {
    for (const p of f.priceIncreases) {
      out.push({
        kind: "price_increase",
        key: `${p.id}:${p.lastDate}`,
        title: `${p.merchant} raised its price`,
        body:
          s.includeAmounts === false
            ? `${p.merchant} charged more than usual`
            : `Now ${formatMoney(Math.abs(p.newAmount))} (up ${formatMoney(Math.abs(p.change))})`,
        priority: "default",
      });
    }
  }
  if (s.syncProblems) {
    for (const c of f.brokenConnections) {
      out.push({
        kind: "sync_problem",
        key: `${c.id}:${c.status}:${c.since}`,
        title: `${c.institution} needs attention`,
        body:
          c.status === "needs_reauth"
            ? "Reconnect it in Settings → Connections to keep syncing."
            : "Syncing failed. Check Settings → Connections.",
        priority: "high",
      });
    }
  }
  if (s.budgetOverspend) {
    for (const b of f.overBudget) {
      out.push({
        kind: "budget_over",
        key: `${b.categoryId}:${b.month}`,
        title: `Over budget: ${b.category}`,
        body:
          s.includeAmounts === false
            ? `${b.category} is over budget this month`
            : `${formatMoney(b.over)} over this month`,
        priority: "default",
      });
    }
  }
  return out;
}
