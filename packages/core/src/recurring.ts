import { addDays, addMonths, daysBetween } from "./dates";

/**
 * Detect recurring charges and income (subscriptions, bills, paychecks) from history.
 * Heuristic: ≥3 occurrences (≥2 for yearly) from one merchant, in one direction, at a
 * steady cadence with a reasonably steady amount, and not lapsed.
 */

export interface RecurringInput {
  merchantId: string;
  date: string;
  amount: number;
  categoryId?: string | null;
}

export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";

export interface DetectedSeries {
  merchantId: string;
  direction: "in" | "out";
  cadence: Cadence;
  intervalDays: number;
  expectedAmount: number;
  lastAmount: number;
  lastDate: string;
  nextDate: string;
  occurrences: number;
  categoryId: string | null;
  /** lastAmount − typical amount, when the latest charge changed noticeably. */
  priceChange: number | null;
}

/** `amountTol`: how far amounts may stray from typical. Weekly is strict so routine
 * shopping (gas, groceries) isn't mistaken for a bill. */
const CADENCES: { cadence: Cadence; days: number; tol: number; min: number; amountTol: number }[] =
  [
    { cadence: "weekly", days: 7, tol: 1, min: 4, amountTol: 0.1 },
    { cadence: "biweekly", days: 14, tol: 2, min: 3, amountTol: 0.35 },
    { cadence: "monthly", days: 30, tol: 4, min: 3, amountTol: 0.35 },
    { cadence: "quarterly", days: 91, tol: 10, min: 3, amountTol: 0.35 },
    { cadence: "yearly", days: 365, tol: 15, min: 2, amountTol: 0.35 },
  ];

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2
    ? (s[m] as number)
    : Math.round(((s[m - 1] as number) + (s[m] as number)) / 2);
};

/** Monthly cost of a series in minor units (for "your subscriptions cost $X/month"). */
export function monthlyCost(s: Pick<DetectedSeries, "cadence" | "expectedAmount">): number {
  const perYear = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, yearly: 1 }[s.cadence];
  return Math.round((Math.abs(s.expectedAmount) * perYear) / 12);
}

export function detectRecurring(txns: readonly RecurringInput[], today: string): DetectedSeries[] {
  const groups = new Map<string, RecurringInput[]>();
  for (const t of txns) {
    if (t.amount === 0) continue;
    const key = `${t.merchantId}|${t.amount > 0 ? "in" : "out"}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  const out: DetectedSeries[] = [];
  for (const [key, rows] of groups) {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    // Collapse same-day duplicates (e.g. split charges) into one occurrence.
    const occ: RecurringInput[] = [];
    for (const r of sorted) {
      const prev = occ[occ.length - 1];
      if (prev && prev.date === r.date) prev.amount += r.amount;
      else occ.push({ ...r });
    }
    if (occ.length < 2) continue;

    const intervals = occ
      .slice(1)
      .map((r, i) => daysBetween((occ[i] as RecurringInput).date, r.date));
    const typicalInterval = median(intervals);
    const match = CADENCES.find((c) => Math.abs(typicalInterval - c.days) <= c.tol);
    if (!match || occ.length < match.min) continue;
    const onBeat = intervals.filter((d) => Math.abs(d - match.days) <= match.tol * 2).length;
    if (onBeat / intervals.length < 0.7) continue;

    const abs = occ.map((r) => Math.abs(r.amount));
    const typicalAmount = median(abs);
    const steady = abs.filter(
      (a) => Math.abs(a - typicalAmount) <= typicalAmount * match.amountTol,
    ).length;
    if (steady / abs.length < 0.7) continue;

    const last = occ[occ.length - 1] as RecurringInput;
    if (daysBetween(last.date, today) > match.days * 2 + match.tol) continue; // lapsed / cancelled

    const sign = last.amount > 0 ? 1 : -1;
    const before = abs.slice(0, -1);
    const prevTypical = median(before.length ? before : abs);
    const diff = Math.abs(last.amount) - prevTypical;
    const notable = Math.abs(diff) >= Math.max(100, Math.round(prevTypical * 0.03));
    // Only call it a price change when earlier charges were consistent (a subscription),
    // not when the amount always varies (a utility bill, a card payment).
    const consistent =
      before.filter((a) => Math.abs(a - prevTypical) <= prevTypical * 0.02).length >=
      before.length * 0.7;

    const nextDate =
      match.cadence === "monthly"
        ? addMonths(last.date, 1)
        : match.cadence === "quarterly"
          ? addMonths(last.date, 3)
          : match.cadence === "yearly"
            ? addMonths(last.date, 12)
            : addDays(last.date, match.days);

    out.push({
      merchantId: key.split("|")[0] as string,
      direction: sign > 0 ? "in" : "out",
      cadence: match.cadence,
      intervalDays: match.days,
      expectedAmount: sign * prevTypical,
      lastAmount: last.amount,
      lastDate: last.date,
      nextDate,
      occurrences: occ.length,
      categoryId: [...sorted].reverse().find((r) => r.categoryId)?.categoryId ?? null,
      priceChange: notable && consistent && before.length >= 2 ? sign * diff : null,
    });
  }
  return out.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}
