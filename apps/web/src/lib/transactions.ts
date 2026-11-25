import "server-only";
import { schema, type Tx } from "@mm/db";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";

export interface TxnFilters {
  q?: string;
  account?: string;
  category?: string; // uuid | "none"
  from?: string;
  to?: string;
  reviewed?: "no";
  page?: number;
}

const UUID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const PAGE_SIZE = 50;

export function parseFilters(sp: Record<string, string | string[] | undefined>): TxnFilters {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const f: TxnFilters = {};
  const q = one("q")?.trim();
  if (q) f.q = q.slice(0, 100);
  if (one("account") && UUID.test(one("account") as string)) f.account = one("account");
  const c = one("category");
  if (c === "none" || (c && UUID.test(c))) f.category = c;
  if (one("from") && DAY.test(one("from") as string)) f.from = one("from");
  if (one("to") && DAY.test(one("to") as string)) f.to = one("to");
  if (one("reviewed") === "no") f.reviewed = "no";
  const p = Number(one("page"));
  f.page = Number.isInteger(p) && p > 1 ? Math.min(p, 10_000) : 1;
  return f;
}

export async function listTransactions(tx: Tx, f: TxnFilters) {
  const t = schema.transactions;
  const where: (SQL | undefined)[] = [isNull(t.splitParentId)];
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    where.push(
      or(ilike(t.rawDescription, like), ilike(schema.merchants.name, like), ilike(t.notes, like)),
    );
  }
  if (f.account) where.push(eq(t.accountId, f.account));
  if (f.category === "none") where.push(and(isNull(t.categoryId), eq(t.isSplit, false)));
  else if (f.category) where.push(eq(t.categoryId, f.category));
  if (f.from) where.push(gte(t.date, f.from));
  if (f.to) where.push(lte(t.date, f.to));
  if (f.reviewed === "no") where.push(eq(t.reviewed, false));
  const cond = and(...where);

  const rows = await tx
    .select({
      id: t.id,
      date: t.date,
      amount: t.amount,
      pending: t.pending,
      raw: t.rawDescription,
      notes: t.notes,
      excluded: t.excluded,
      reviewed: t.reviewed,
      isSplit: t.isSplit,
      categoryId: t.categoryId,
      categorySource: t.categorySource,
      accountId: t.accountId,
      /** "manual" (added by hand), "file" (imported) or "bank" (synced). Only the first two can be deleted. */
      origin: sql<"manual" | "file" | "bank">`case
        when ${t.providerTransactionId} like 'manual:%' then 'manual'
        when ${t.providerTransactionId} like 'file:%' or ${t.providerTransactionId} like 'ofx:%' then 'file'
        else 'bank' end`,
      merchant: schema.merchants.name,
      category: schema.categories.name,
      account: schema.accounts.name,
    })
    .from(t)
    .innerJoin(schema.accounts, eq(schema.accounts.id, t.accountId))
    .leftJoin(schema.merchants, eq(schema.merchants.id, t.merchantId))
    .leftJoin(schema.categories, eq(schema.categories.id, t.categoryId))
    .where(cond)
    .orderBy(desc(t.date), desc(t.id))
    .limit(PAGE_SIZE + 1)
    .offset(((f.page ?? 1) - 1) * PAGE_SIZE);

  const [{ total }] = (await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(t)
    .leftJoin(schema.merchants, eq(schema.merchants.id, t.merchantId))
    .where(cond)) as [{ total: number }];

  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE, total };
}

export async function splitChildren(tx: Tx, parentIds: string[]) {
  if (parentIds.length === 0) return [];
  const t = schema.transactions;
  return tx
    .select({
      id: t.id,
      parentId: t.splitParentId,
      amount: t.amount,
      categoryId: t.categoryId,
      notes: t.notes,
    })
    .from(t)
    .where(inArray(t.splitParentId, parentIds))
    .orderBy(asc(t.createdAt));
}

export async function categoryOptions(tx: Tx) {
  return tx
    .select({
      id: schema.categories.id,
      name: schema.categories.name,
      group: schema.categoryGroups.name,
      hidden: schema.categories.hidden,
    })
    .from(schema.categories)
    .innerJoin(schema.categoryGroups, eq(schema.categoryGroups.id, schema.categories.groupId))
    .orderBy(
      asc(schema.categoryGroups.sortOrder),
      asc(schema.categories.sortOrder),
      asc(schema.categories.name),
    );
}

export async function accountOptions(tx: Tx) {
  return tx
    .select({
      id: schema.accounts.id,
      name: schema.accounts.name,
      /** True for accounts that sync from a bank: transactions can't be added to those by hand. */
      synced: sql<boolean>`${schema.accounts.connectionId} is not null`,
    })
    .from(schema.accounts)
    .orderBy(asc(schema.accounts.sortOrder));
}
