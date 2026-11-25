/**
 * Deterministic "worth a look" findings. No AI involved: these feed the dashboard
 * directly and are handed to the digest writer as facts.
 */

export interface CategoryAnomaly {
  category: string;
  current: number;
  typical: number;
  /** current / typical */
  ratio: number;
}

/**
 * Categories running well above their typical level for the same span of time.
 * `history` holds the same-length periods before the current one (e.g. prior weeks).
 */
export function categoryAnomalies(
  current: readonly { category: string; spent: number }[],
  history: readonly { category: string; spent: number[] }[],
  opts: { minRatio?: number; minDelta?: number; minHistory?: number; minActiveShare?: number } = {},
): CategoryAnomaly[] {
  const minRatio = opts.minRatio ?? 1.4;
  const minDelta = opts.minDelta ?? 5_000; // $50
  const minHistory = opts.minHistory ?? 3;
  // Only compare categories with spending in most past periods. A monthly bill landing in one
  // week, or an occasional night out, isn't "unusual" just because the average week is low.
  const minActiveShare = opts.minActiveShare ?? 0.6;
  const hist = new Map(history.map((h) => [h.category, h.spent]));
  const out: CategoryAnomaly[] = [];
  for (const c of current) {
    const past = hist.get(c.category) ?? [];
    if (past.length < minHistory) continue;
    if (past.filter((v) => v > 0).length < Math.ceil(past.length * minActiveShare)) continue;
    const typical = Math.round(past.reduce((a, b) => a + b, 0) / past.length);
    if (typical <= 0) continue;
    const ratio = c.spent / typical;
    if (ratio >= minRatio && c.spent - typical >= minDelta)
      out.push({ category: c.category, current: c.spent, typical, ratio });
  }
  return out.sort((a, b) => b.current - b.typical - (a.current - a.typical));
}

export interface UnusualCharge {
  id: string;
  merchant: string;
  amount: number;
  typical: number;
}

/** Single charges far above what a merchant usually costs (3× the median, ≥ $50 more). */
export function unusualCharges(
  charges: readonly { id: string; merchant: string; amount: number; history: number[] }[],
): UnusualCharge[] {
  const out: UnusualCharge[] = [];
  for (const c of charges) {
    if (c.history.length < 3) continue;
    const s = [...c.history].sort((a, b) => a - b);
    const median = s[Math.floor(s.length / 2)] as number;
    if (median > 0 && c.amount >= median * 3 && c.amount - median >= 5_000) {
      out.push({ id: c.id, merchant: c.merchant, amount: c.amount, typical: median });
    }
  }
  return out.sort((a, b) => b.amount - a.amount);
}
