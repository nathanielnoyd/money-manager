import { daysBetween } from "./dates";

/**
 * Investment math on integer minor units.
 */

export const ASSET_CLASSES = ["Stocks", "Bonds", "Cash", "Crypto", "Other"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

/** Map a provider security type (Plaid-style) to a broad asset class. */
export function assetClass(type: string | null | undefined): AssetClass {
  const t = (type ?? "").toLowerCase();
  if (/equity|etf|mutual|stock/.test(t)) return "Stocks";
  if (/fixed|bond|treasury/.test(t)) return "Bonds";
  if (/cash|money market/.test(t)) return "Cash";
  if (/crypto/.test(t)) return "Crypto";
  return "Other";
}

export function allocation(holdings: readonly { type?: string | null; value: number }[]) {
  const total = holdings.reduce((t, h) => t + Math.max(0, h.value), 0);
  const by = new Map<AssetClass, number>();
  for (const h of holdings)
    by.set(assetClass(h.type), (by.get(assetClass(h.type)) ?? 0) + Math.max(0, h.value));
  return ASSET_CLASSES.filter((c) => (by.get(c) ?? 0) > 0)
    .map((c) => ({
      assetClass: c,
      value: by.get(c) ?? 0,
      share: total ? (by.get(c) ?? 0) / total : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

export interface PeriodReturn {
  startValue: number;
  endValue: number;
  /** Net money added (+) or withdrawn (−) during the period. */
  netContributions: number;
  /** Change not explained by contributions: market gains/losses, dividends, fees. */
  gain: number;
  /** Modified Dietz return, or null when there's nothing to measure against. */
  returnPct: number | null;
}

/**
 * Modified Dietz: gain / (start value + time-weighted contributions). A standard, cheap
 * approximation of time-weighted return that doesn't need daily valuations.
 */
export function modifiedDietz(
  startValue: number,
  endValue: number,
  flows: readonly { date: string; amount: number }[],
  start: string,
  end: string,
): PeriodReturn {
  const days = Math.max(1, daysBetween(start, end));
  const net = flows.reduce((t, f) => t + f.amount, 0);
  const weighted = flows.reduce(
    (t, f) => t + (f.amount * Math.max(0, daysBetween(f.date, end))) / days,
    0,
  );
  const gain = endValue - startValue - net;
  const base = startValue + weighted;
  return {
    startValue,
    endValue,
    netContributions: net,
    gain,
    returnPct: base > 0 ? gain / base : null,
  };
}

export function unrealizedGain(holdings: readonly { value: number; costBasis?: number | null }[]) {
  const known = holdings.filter((h) => h.costBasis !== null && h.costBasis !== undefined);
  const basis = known.reduce((t, h) => t + (h.costBasis as number), 0);
  const value = known.reduce((t, h) => t + h.value, 0);
  return {
    basis,
    gain: value - basis,
    pct: basis > 0 ? (value - basis) / basis : null,
    coverage: known.length / Math.max(1, holdings.length),
  };
}
