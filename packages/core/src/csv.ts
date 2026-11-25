/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF/LF, BOM. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const delim = delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") inQuotes = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

function detectDelimiter(src: string): string {
  const firstLine = src.slice(0, src.search(/\r?\n/) >>> 0 || 1000);
  const counts = [",", ";", "\t", "|"].map((d) => [d, firstLine.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0]?.[0] ?? ",";
}

export type DateFormat = "YMD" | "MDY" | "DMY";

/** Parse a date in the given order into YYYY-MM-DD, or null. Accepts /, -, . separators and YYYYMMDD. */
export function parseDate(input: string, format: DateFormat): string | null {
  const s = input.trim().split(/[ T]/)[0] ?? "";
  let y: number;
  let m: number;
  let d: number;
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (compact) {
    [y, m, d] = [Number(compact[1]), Number(compact[2]), Number(compact[3])];
  } else {
    const parts = s.split(/[/.-]/);
    if (parts.length !== 3 || parts.some((p) => !/^\d{1,4}$/.test(p))) return null;
    const [a, b, c] = parts.map(Number) as [number, number, number];
    if (format === "YMD") [y, m, d] = [a, b, c];
    else if (format === "MDY") [m, d, y] = [a, b, c];
    else [d, m, y] = [a, b, c];
    if (y < 100) y += y < 70 ? 2000 : 1900;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null; // e.g. Feb 30
  return dt.toISOString().slice(0, 10);
}

/** Pick the date order that parses every sample; prefer an unambiguous one, then MDY. */
export function detectDateFormat(samples: string[]): DateFormat | null {
  const candidates: DateFormat[] = ["YMD", "MDY", "DMY"];
  const ok = candidates.filter((f) => samples.length > 0 && samples.every((s) => parseDate(s, f)));
  if (ok.length === 0) return null;
  if (ok.includes("YMD") && samples.some((s) => /^\d{4}/.test(s.trim()))) return "YMD";
  return ok.includes("MDY") ? "MDY" : (ok[0] ?? null);
}

/**
 * One CSV field. Quotes when needed, and neutralizes text a spreadsheet would run as a
 * formula: bank descriptions and notes are other people's text, and a cell starting with
 * = + - or @ executes in Excel and Sheets. Pass `numeric` for values we produced ourselves.
 */
export function csvField(value: string | number | boolean | null | undefined, numeric = false) {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (!numeric && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Rows to CSV text (RFC 4180 line endings). The first row is the header. `numericColumns` are
 * the indexes of columns holding numbers we formatted ourselves (amounts such as "-12.50"),
 * which must not get the formula guard.
 */
export function toCsv(
  rows: (string | number | boolean | null | undefined)[][],
  numericColumns: number[] = [],
): string {
  const numeric = new Set(numericColumns);
  return `${rows.map((r) => r.map((v, i) => csvField(v, numeric.has(i) || typeof v === "number")).join(",")).join("\r\n")}\r\n`;
}
