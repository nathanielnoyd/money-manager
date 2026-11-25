/**
 * Calendar helpers on ISO dates (YYYY-MM-DD). Date arithmetic is always done in UTC so a date
 * never shifts. The one place a time zone matters is deciding what "today" is: see todayIso.
 */

const toDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

/** Same day-of-month n months later, clamped (Jan 31 + 1 month → Feb 28/29). */
export function addMonths(iso: string, months: number): string {
  const d = toDate(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return isoDate(d);
}

export const firstOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`;
export const endOfMonth = (iso: string) => addDays(addMonths(firstOfMonth(iso), 1), -1);

export const daysBetween = (a: string, b: string) =>
  Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);

/** "2026-11" or "2026-11-01" → "November 2026". */
export function monthLabel(iso: string, style: "long" | "short" = "long"): string {
  return toDate(firstOfMonth(iso.length === 7 ? `${iso}-01` : iso)).toLocaleDateString("en-US", {
    month: style,
    year: "numeric",
    timeZone: "UTC",
  });
}

let zone: string | undefined;

/**
 * The time zone this instance keeps its calendar in: the TZ environment variable (an IANA
 * name such as America/Chicago), or UTC. The database session uses the same zone (@mm/db
 * createPool), so "today" and "this month" agree between code and SQL.
 */
export function appTimeZone(): string {
  if (zone) return zone;
  const wanted = (typeof process !== "undefined" && process.env?.TZ?.trim()) || "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: wanted });
    zone = /^[A-Za-z0-9_+\-/]{1,64}$/.test(wanted) ? wanted : "UTC";
  } catch {
    zone = "UTC";
  }
  return zone;
}

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/** The calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function isoDateIn(d: Date, timeZone: string): string {
  let f = dayFormats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormats.set(timeZone, f);
  }
  return f.format(d);
}

/** Today's date where the household lives (see appTimeZone), not in UTC. */
export const todayIso = (now = new Date()) => isoDateIn(now, appTimeZone());
