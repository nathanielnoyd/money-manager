/**
 * Money is always stored and computed as integer minor units (e.g. cents)
 * alongside an ISO-4217 currency code. Never use floats for balances.
 */
export type Minor = number;

export function toMinor(major: number, fractionDigits = 2): Minor {
  return Math.round(major * 10 ** fractionDigits);
}

export function fromMinor(minor: Minor, fractionDigits = 2): number {
  return minor / 10 ** fractionDigits;
}

const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(
  minor: Minor,
  currency = "USD",
  opts: { signed?: boolean; compact?: boolean; locale?: string } = {},
): string {
  const key = `${opts.locale ?? "en-US"}|${currency}|${opts.signed ? 1 : 0}|${opts.compact ? 1 : 0}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(opts.locale ?? "en-US", {
      style: "currency",
      currency,
      signDisplay: opts.signed ? "exceptZero" : "auto",
      notation: opts.compact ? "compact" : "standard",
      maximumFractionDigits: opts.compact ? 1 : undefined,
    });
    formatters.set(key, fmt);
  }
  const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
  // Normalise -0 so an empty liability never renders as "-$0.00".
  return fmt.format(fromMinor(minor === 0 ? 0 : minor, opts.compact ? 2 : digits));
}

/**
 * Parse a decimal string ("1,234.56", "-12.3", "(45.00)", "$9") into minor units
 * without going through floating point. Returns null if it isn't a number.
 */
export function parseDecimalToMinor(input: string, fractionDigits = 2): Minor | null {
  let s = input.trim().replace(/[\s$€£¥,]/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-") || s.startsWith("−")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) return null;
  const whole = m[1] || "0";
  const frac = (m[2] ?? "").padEnd(fractionDigits + 1, "0");
  let minor = Number(whole) * 10 ** fractionDigits + Number(frac.slice(0, fractionDigits) || "0");
  if (Number(frac[fractionDigits]) >= 5) minor += 1; // round half up on the next digit
  if (!Number.isSafeInteger(minor)) return null;
  return negative ? -minor : minor;
}

/**
 * Minor units as a plain decimal string ("-12.50"), for files other programs read. Built from
 * integers, never through a float, so every cent survives.
 */
export function minorToDecimal(minor: Minor, fractionDigits = 2): string {
  const abs = Math.abs(Math.trunc(minor))
    .toString()
    .padStart(fractionDigits + 1, "0");
  const whole = abs.slice(0, abs.length - fractionDigits);
  const frac = fractionDigits > 0 ? `.${abs.slice(-fractionDigits)}` : "";
  return `${minor < 0 ? "-" : ""}${whole}${frac}`;
}
