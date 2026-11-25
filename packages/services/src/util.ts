import { schema, type Tx } from "@mm/db";
import { inArray } from "drizzle-orm";
import { z } from "zod";

/** Cents → dollars for outputs. */
export const dollars = (minor: number | string | null | undefined) =>
  Math.round(Number(minor ?? 0)) / 100;

/** Dollars → cents for inputs. */
export const cents = (major: number) => Math.round(major * 100);

export const DateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .describe("Date, YYYY-MM-DD");

export const MonthStr = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "Use the first day of the month, YYYY-MM-01")
  .describe("First day of the month, YYYY-MM-01");

/** A non-negative dollar amount with at most cents precision, capped well below bigint limits. */
export const Dollars = z
  .number()
  .finite()
  .min(0)
  .max(1_000_000_000)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "At most two decimal places");

/**
 * Foreign keys don't apply row-level security: Postgres would happily let household A
 * store a reference to household B's category. Before saving caller-supplied ids as
 * references, confirm they're visible under the caller's RLS scope (i.e. their own).
 */
const OWNED_TABLES = {
  categories: schema.categories,
  categoryGroups: schema.categoryGroups,
  accounts: schema.accounts,
  merchants: schema.merchants,
  transactions: schema.transactions,
} as const;

export async function ownsAll(
  tx: Tx,
  table: keyof typeof OWNED_TABLES,
  ids: (string | null | undefined)[],
): Promise<boolean> {
  const unique = [...new Set(ids.filter((x): x is string => typeof x === "string"))];
  if (unique.length === 0) return true;
  const t = OWNED_TABLES[table];
  const rows = await tx.select({ id: t.id }).from(t).where(inArray(t.id, unique));
  return rows.length === unique.length;
}
