import { type DateFormat, detectDateFormat, parseDate } from "./csv";
import { parseDecimalToMinor } from "./money";
import { parseOfx } from "./ofx";

/** A transaction ready to ingest, independent of where it came from. */
export interface ImportedTransaction {
  providerTransactionId: string;
  date: string;
  amount: number; // minor units, + in / - out
  description: string;
  pending: boolean;
}

export interface CsvMapping {
  hasHeader: boolean;
  dateColumn: number;
  descriptionColumn: number;
  /** Either a single signed amount column… */
  amountColumn?: number;
  /** …or separate money-out / money-in columns. */
  debitColumn?: number;
  creditColumn?: number;
  dateFormat: DateFormat;
  /** Flip signs (some card exports show purchases as positive). */
  invert: boolean;
}

const HEADER_HINTS = {
  date: /^(transaction |posting |post(ed)? )?date$|^date posted$|^posted$/i,
  description: /^(description|payee|name|merchant|details|memo|transaction description)$/i,
  amount: /^(amount|transaction amount|amount \(.*\))$/i,
  debit: /^(debit|withdrawal|withdrawals|money out|paid out|charge)s?$/i,
  credit: /^(credit|deposit|deposits|money in|paid in|payment)s?$/i,
};

/** Guess a mapping from the header row and a sample of data rows. */
export function guessCsvMapping(rows: string[][]): CsvMapping {
  const header = (rows[0] ?? []).map((h) => h.trim());
  const find = (re: RegExp) => header.findIndex((h) => re.test(h));
  const hasHeader = header.some((h) => /[a-z]/i.test(h)) && find(HEADER_HINTS.date) >= 0;
  const dateColumn = Math.max(0, find(HEADER_HINTS.date));
  const descriptionColumn = Math.max(0, find(HEADER_HINTS.description));
  const amount = find(HEADER_HINTS.amount);
  const debit = find(HEADER_HINTS.debit);
  const credit = find(HEADER_HINTS.credit);
  const data = rows.slice(hasHeader ? 1 : 0, 50);
  return {
    hasHeader,
    dateColumn,
    descriptionColumn,
    amountColumn: amount >= 0 ? amount : debit >= 0 || credit >= 0 ? undefined : 2,
    debitColumn: amount < 0 && debit >= 0 ? debit : undefined,
    creditColumn: amount < 0 && credit >= 0 ? credit : undefined,
    dateFormat: detectDateFormat(data.map((r) => r[dateColumn] ?? "")) ?? "MDY",
    invert: false,
  };
}

export interface ImportResult {
  transactions: ImportedTransaction[];
  errors: { row: number; message: string }[];
}

export function csvToTransactions(rows: string[][], map: CsvMapping): ImportResult {
  const out: ImportedTransaction[] = [];
  const errors: ImportResult["errors"] = [];
  const seen = new Map<string, number>();
  const start = map.hasHeader ? 1 : 0;
  for (let i = start; i < rows.length; i++) {
    const r = rows[i] as string[];
    const date = parseDate(r[map.dateColumn] ?? "", map.dateFormat);
    if (!date) {
      errors.push({ row: i + 1, message: `Unreadable date "${r[map.dateColumn] ?? ""}"` });
      continue;
    }
    let amount: number | null;
    if (map.amountColumn !== undefined) {
      amount = parseDecimalToMinor(r[map.amountColumn] ?? "");
    } else {
      const out_ = parseDecimalToMinor(r[map.debitColumn ?? -1] ?? "") ?? 0;
      const in_ = parseDecimalToMinor(r[map.creditColumn ?? -1] ?? "") ?? 0;
      amount = Math.abs(in_) - Math.abs(out_);
    }
    if (amount === null) {
      errors.push({ row: i + 1, message: "Unreadable amount" });
      continue;
    }
    if (map.invert) amount = -amount;
    const description = (r[map.descriptionColumn] ?? "").trim() || "Unknown";
    out.push({
      providerTransactionId: stableId(seen, date, amount, description),
      date,
      amount,
      description,
      pending: false,
    });
  }
  return { transactions: out, errors };
}

export function ofxToTransactions(
  text: string,
): ImportResult & { statement: ReturnType<typeof parseOfx> } {
  const statement = parseOfx(text);
  const seen = new Map<string, number>();
  const errors: ImportResult["errors"] = [];
  const transactions: ImportedTransaction[] = [];
  statement.transactions.forEach((t, i) => {
    const amount = parseDecimalToMinor(t.amount);
    if (amount === null) {
      errors.push({ row: i + 1, message: "Unreadable amount" });
      return;
    }
    const description =
      t.memo && t.name !== t.memo && t.name.length < 12 ? `${t.name} ${t.memo}` : t.name;
    transactions.push({
      providerTransactionId: t.fitId
        ? `ofx:${t.fitId}`
        : stableId(seen, t.date, amount, description),
      date: t.date,
      amount,
      description,
      pending: false,
    });
  });
  return { transactions, errors, statement };
}

/** Deterministic id so re-importing the same file never creates duplicates. */
function stableId(
  seen: Map<string, number>,
  date: string,
  amount: number,
  description: string,
): string {
  const key = `${date}|${amount}|${description.toLowerCase()}`;
  const n = (seen.get(key) ?? 0) + 1;
  seen.set(key, n);
  return `file:${cyrb53(`${key}|${n}`)}`;
}

/** Small, fast, browser-safe 53-bit string hash (not cryptographic). */
function cyrb53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
