/**
 * Budget arithmetic. "Spent" is net outflow for a category in a month (refunds reduce
 * it), in positive minor units. Everything is integer minor units.
 */

export interface MonthActual {
  month: string; // YYYY-MM-01
  budgeted: number;
  spent: number;
}

/**
 * Carry-over into `month` for a rollover category: the sum of (budgeted − spent) over
 * every earlier month, starting from the first month that had a budget. Overspending
 * carries forward as a negative.
 */
export function rolloverCarry(history: readonly MonthActual[], month: string): number {
  const prior = history
    .filter((h) => h.month < month)
    .sort((a, b) => a.month.localeCompare(b.month));
  const start = prior.findIndex((h) => h.budgeted > 0);
  if (start < 0) return 0;
  return prior.slice(start).reduce((t, h) => t + h.budgeted - h.spent, 0);
}

export interface BudgetLine {
  budgeted: number;
  carry: number;
  spent: number;
  available: number;
  remaining: number;
  /** 0..1+ share of `available` used (Infinity if nothing was available but money was spent). */
  progress: number;
  status: "under" | "near" | "over" | "unbudgeted";
}

export function budgetLine(budgeted: number, spent: number, carry = 0): BudgetLine {
  const available = budgeted + carry;
  const remaining = available - spent;
  const progress = available > 0 ? spent / available : spent > 0 ? Number.POSITIVE_INFINITY : 0;
  const status =
    available <= 0 && budgeted === 0
      ? "unbudgeted"
      : remaining < 0
        ? "over"
        : progress >= 0.85
          ? "near"
          : "under";
  return { budgeted, carry, spent, available, remaining, progress, status };
}

/** Suggest a budget from recent months: their average, rounded up to the nearest $5. */
export function suggestBudget(recentSpent: readonly number[]): number {
  const months = recentSpent.filter((s) => s > 0);
  if (months.length === 0) return 0;
  const avg = months.reduce((a, b) => a + b, 0) / recentSpent.length;
  return Math.ceil(avg / 500) * 500;
}

/** Zero-based budgeting: income not yet assigned to a category (negative = over-assigned). */
export const leftToBudget = (income: number, totalBudgeted: number) => income - totalBudgeted;
