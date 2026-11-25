import {
  type AccountType,
  applyRules,
  cleanMerchantName,
  isLiability,
  type RuleDef,
  todayIso,
} from "@mm/core";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Tx } from "./client";
import { accounts, balanceSnapshots, merchants, rules, transactions } from "./schema";
import { detectTransfers } from "./transfers";

/**
 * Persisting bank data, shared by provider sync (worker) and file import (web).
 * Every function expects to run inside `withHousehold(...)`.
 */

export interface IncomingAccount {
  providerAccountId: string;
  name: string;
  type: AccountType;
  subtype?: string;
  mask?: string;
  currency: string;
  /** Asset perspective: negative = owed. */
  balance: number;
  availableBalance?: number;
  balanceDate?: Date;
}

export interface IncomingTransaction {
  accountId: string;
  providerTransactionId: string;
  date: string;
  amount: number;
  pending: boolean;
  description: string;
  /** Provider's clean merchant name, when it has one (Plaid). Otherwise we derive it. */
  merchantName?: string;
  /** For a posted transaction: the provider id of the pending one it replaces. */
  pendingTransactionId?: string;
  /** Provider's category hint (Plaid personal_finance_category.detailed). */
  providerCategory?: string;
  /** The file import this row belongs to (see the imports table). */
  importId?: string;
}

export interface IngestResult {
  added: number;
  modified: number;
  removed: number;
}

const today = todayIso;

/** Accounts store liabilities as a positive "amount owed". */
export const storedBalance = (type: AccountType, assetBalance: number) =>
  isLiability(type) ? -assetBalance : assetBalance;

/** Upsert a day's balance snapshot. */
export async function recordBalance(
  tx: Tx,
  householdId: string,
  accountId: string,
  balance: number,
  date = today(),
): Promise<void> {
  await tx
    .insert(balanceSnapshots)
    .values({ householdId, accountId, date, balance })
    .onConflictDoUpdate({
      target: [balanceSnapshots.accountId, balanceSnapshots.date],
      set: { balance },
    });
}

/**
 * Create or update provider accounts. New accounts get the provider's guess at a type;
 * existing ones keep the user's chosen name/type and only receive fresh balances.
 * Returns providerAccountId → account id.
 */
export async function upsertProviderAccounts(
  tx: Tx,
  householdId: string,
  connectionId: string,
  incoming: IncomingAccount[],
): Promise<Map<string, string>> {
  const existing = await tx.select().from(accounts).where(eq(accounts.connectionId, connectionId));
  const byProviderId = new Map(existing.map((a) => [a.providerAccountId, a]));
  const out = new Map<string, string>();
  let order = existing.length;

  for (const a of incoming) {
    const prev = byProviderId.get(a.providerAccountId);
    const type = prev?.type ?? a.type;
    const current = storedBalance(type, a.balance);
    const available =
      a.availableBalance === undefined ? null : storedBalance(type, a.availableBalance);
    let id: string;
    if (prev) {
      await tx
        .update(accounts)
        .set({
          officialName: a.name,
          currentBalance: current,
          availableBalance: available,
          currency: a.currency,
          balanceUpdatedAt: a.balanceDate ?? new Date(),
        })
        .where(eq(accounts.id, prev.id));
      id = prev.id;
    } else {
      const [row] = await tx
        .insert(accounts)
        .values({
          householdId,
          connectionId,
          providerAccountId: a.providerAccountId,
          name: a.name,
          officialName: a.name,
          type,
          subtype: a.subtype,
          mask: a.mask,
          currency: a.currency,
          currentBalance: current,
          availableBalance: available,
          balanceUpdatedAt: a.balanceDate ?? new Date(),
          sortOrder: order++,
        })
        .returning({ id: accounts.id });
      if (!row) throw new Error("account insert failed");
      id = row.id;
    }
    out.set(a.providerAccountId, id);
    await recordBalance(tx, householdId, id, current);
  }
  return out;
}

async function loadRules(tx: Tx): Promise<RuleDef[]> {
  const rows = await tx.select().from(rules).where(eq(rules.enabled, true));
  return rows.map((r) => ({
    id: r.id,
    priority: r.priority,
    enabled: r.enabled,
    conditions: r.conditions as RuleDef["conditions"],
    actions: r.actions as RuleDef["actions"],
  }));
}

/** Find or create merchants by name; returns name → { id, defaultCategoryId }. */
async function resolveMerchants(tx: Tx, householdId: string, names: string[]) {
  const unique = [...new Set(names)].filter(Boolean);
  const map = new Map<string, { id: string; defaultCategoryId: string | null }>();
  if (unique.length === 0) return map;
  for (let i = 0; i < unique.length; i += 500) {
    await tx
      .insert(merchants)
      .values(unique.slice(i, i + 500).map((name) => ({ householdId, name })))
      .onConflictDoNothing();
  }
  const rows = await tx
    .select({
      id: merchants.id,
      name: merchants.name,
      defaultCategoryId: merchants.defaultCategoryId,
    })
    .from(merchants)
    .where(inArray(merchants.name, unique));
  for (const r of rows) map.set(r.name, { id: r.id, defaultCategoryId: r.defaultCategoryId });
  return map;
}

const dayDiff = (a: string, b: string) =>
  Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) /
  86_400_000;

/**
 * Insert new transactions (with merchant cleanup + rules), update changed ones, and
 * reconcile pending → posted: stored pending rows inside the provider's window that
 * weren't returned again are removed, and the user's edits (category, notes, …) carry
 * over to the posted transaction that replaced them.
 */
export async function ingestTransactions(
  tx: Tx,
  householdId: string,
  incoming: IncomingTransaction[],
  opts: {
    pruneMissingPending?: { accountIds: string[]; start: string };
    removedProviderIds?: { accountIds: string[]; ids: string[] };
    /** Skip transfer detection, for a caller that is about to set the category itself. */
    skipTransferDetection?: boolean;
  } = {},
): Promise<IngestResult> {
  const result: IngestResult = { added: 0, modified: 0, removed: 0 };
  const accountIds = [...new Set(incoming.map((t) => t.accountId))];
  const ruleDefs = await loadRules(tx);

  const existing =
    accountIds.length === 0
      ? []
      : await tx
          .select()
          .from(transactions)
          .where(
            and(
              inArray(transactions.accountId, accountIds),
              inArray(
                transactions.providerTransactionId,
                incoming.map((t) => t.providerTransactionId),
              ),
            ),
          );
  const key = (accountId: string, pid: string | null) => `${accountId}|${pid}`;
  const existingByKey = new Map(
    existing.map((e) => [key(e.accountId, e.providerTransactionId), e]),
  );

  // 1. Update rows we already have (provider-owned fields only; user edits are kept).
  for (const t of incoming) {
    const prev = existingByKey.get(key(t.accountId, t.providerTransactionId));
    if (!prev) continue;
    if (
      prev.amount !== t.amount ||
      prev.date !== t.date ||
      prev.pending !== t.pending ||
      prev.rawDescription !== t.description
    ) {
      const provider = {
        amount: t.amount,
        date: t.date,
        pending: t.pending,
        rawDescription: t.description,
      };
      if (prev.isSplit && prev.amount !== t.amount) {
        // The parts no longer add up to the transaction. Drop the split and ask for a new one
        // rather than leave parts that total something else.
        await tx.delete(transactions).where(eq(transactions.splitParentId, prev.id));
        await tx
          .update(transactions)
          .set({ ...provider, isSplit: false, reviewed: false })
          .where(eq(transactions.id, prev.id));
      } else {
        await tx.update(transactions).set(provider).where(eq(transactions.id, prev.id));
        if (prev.isSplit) {
          await tx
            .update(transactions)
            .set({ date: t.date, pending: t.pending, rawDescription: t.description })
            .where(eq(transactions.splitParentId, prev.id));
        }
      }
      result.modified++;
    }
  }

  // 2. Pending rows that disappeared from the provider's window.
  const incomingKeys = new Set(incoming.map((t) => key(t.accountId, t.providerTransactionId)));
  const vanishedPending =
    opts.pruneMissingPending && opts.pruneMissingPending.accountIds.length > 0
      ? (
          await tx
            .select()
            .from(transactions)
            .where(
              and(
                inArray(transactions.accountId, opts.pruneMissingPending.accountIds),
                eq(transactions.pending, true),
                gte(transactions.date, opts.pruneMissingPending.start),
              ),
            )
        ).filter((p) => !incomingKeys.has(key(p.accountId, p.providerTransactionId)))
      : [];

  // Pending rows the provider explicitly removed or replaced also donate their edits.
  const linkedIds = [
    ...new Set([
      ...(opts.removedProviderIds?.ids ?? []),
      ...incoming.flatMap((t) => (t.pendingTransactionId ? [t.pendingTransactionId] : [])),
    ]),
  ];
  const linkedAccounts = [
    ...new Set([...accountIds, ...(opts.removedProviderIds?.accountIds ?? [])]),
  ];
  const linkedPending =
    linkedIds.length && linkedAccounts.length
      ? await tx
          .select()
          .from(transactions)
          .where(
            and(
              inArray(transactions.accountId, linkedAccounts),
              inArray(transactions.providerTransactionId, linkedIds),
              eq(transactions.pending, true),
            ),
          )
      : [];
  const candidates = [
    ...new Map([...vanishedPending, ...linkedPending].map((p) => [p.id, p])).values(),
  ];

  // 3. Insert new rows.
  const fresh = incoming.filter(
    (t) => !existingByKey.has(key(t.accountId, t.providerTransactionId)),
  );
  const cleaned = fresh.map((t) => {
    const merchant = t.merchantName?.trim() || cleanMerchantName(t.description);
    const outcome = applyRules(ruleDefs, {
      description: t.description,
      merchant,
      amount: t.amount,
      accountId: t.accountId,
    });
    return { t, merchant: outcome.setMerchantName ?? merchant, outcome };
  });
  const merchantMap = await resolveMerchants(
    tx,
    householdId,
    cleaned.map((c) => c.merchant),
  );
  const insertedIds: string[] = [];
  const claimed = new Set<string>();
  /** Posted transactions that replace a split pending one of the same amount: new key → old parent id. */
  const splitsToMove = new Map<string, string>();
  const rows = cleaned.map(({ t, merchant, outcome }) => {
    const m = merchantMap.get(merchant);
    let carried: (typeof candidates)[number] | undefined;
    if (!t.pending) {
      carried =
        (t.pendingTransactionId &&
          candidates.find(
            (p) => !claimed.has(p.id) && p.providerTransactionId === t.pendingTransactionId,
          )) ||
        candidates.find(
          (p) =>
            !claimed.has(p.id) &&
            p.accountId === t.accountId &&
            p.amount === t.amount &&
            dayDiff(p.date, t.date) <= 7,
        );
      if (carried) {
        claimed.add(carried.id);
        if (carried.isSplit && carried.amount === t.amount)
          splitsToMove.set(key(t.accountId, t.providerTransactionId), carried.id);
      }
    }
    return {
      householdId,
      accountId: t.accountId,
      providerTransactionId: t.providerTransactionId,
      date: t.date,
      amount: t.amount,
      pending: t.pending,
      rawDescription: t.description,
      providerCategory: t.providerCategory ?? null,
      importId: t.importId ?? null,
      merchantId: carried?.merchantId ?? m?.id ?? null,
      categoryId:
        carried?.categoryId ??
        (outcome.setCategoryId !== undefined
          ? outcome.setCategoryId
          : (m?.defaultCategoryId ?? null)),
      categorySource:
        carried?.categorySource ??
        (outcome.setCategoryId !== undefined ? "rule" : m?.defaultCategoryId ? "merchant" : null),
      notes: carried?.notes ?? null,
      reviewed: carried?.reviewed ?? outcome.markReviewed ?? false,
      excluded: carried?.excluded ?? outcome.exclude ?? false,
    };
  });
  for (let i = 0; i < rows.length; i += 500) {
    const inserted = await tx
      .insert(transactions)
      .values(rows.slice(i, i + 500))
      .onConflictDoNothing()
      .returning({
        id: transactions.id,
        accountId: transactions.accountId,
        providerTransactionId: transactions.providerTransactionId,
        date: transactions.date,
        rawDescription: transactions.rawDescription,
      });
    result.added += inserted.length;
    insertedIds.push(...inserted.map((r) => r.id));
    // Move the parts of a split from the pending row to the posted row that replaces it,
    // before step 4 deletes the pending row (which would take its parts with it).
    for (const row of inserted) {
      const oldParent = splitsToMove.get(key(row.accountId, row.providerTransactionId));
      if (!oldParent) continue;
      await tx
        .update(transactions)
        .set({
          splitParentId: row.id,
          date: row.date,
          pending: false,
          rawDescription: row.rawDescription,
        })
        .where(eq(transactions.splitParentId, oldParent));
      await tx
        .update(transactions)
        .set({ isSplit: true, categoryId: null, categorySource: null, reviewed: true })
        .where(eq(transactions.id, row.id));
    }
  }

  // 4. Delete vanished/replaced pending rows, then anything else the provider removed.
  const replaced = [...new Set([...vanishedPending.map((p) => p.id), ...claimed])];
  if (replaced.length > 0) {
    const gone = await tx
      .delete(transactions)
      .where(inArray(transactions.id, replaced))
      .returning({ id: transactions.id });
    result.removed += gone.length;
  }
  if (opts.removedProviderIds && opts.removedProviderIds.ids.length > 0) {
    const gone = await tx
      .delete(transactions)
      .where(
        and(
          inArray(transactions.accountId, opts.removedProviderIds.accountIds),
          inArray(transactions.providerTransactionId, opts.removedProviderIds.ids),
        ),
      )
      .returning({ id: transactions.id });
    result.removed += gone.length;
  }
  // 5. Moves between the household's own accounts become transfers, not spending plus income.
  if (!opts.skipTransferDetection) await detectTransfers(tx, insertedIds);
  return result;
}

/**
 * Re-run rules over existing transactions (e.g. after creating a rule).
 * Only touches fields a matching rule sets. Returns the number of rows changed.
 */
export async function applyRulesToExisting(
  tx: Tx,
  opts: { ruleId?: string; onlyUnreviewed?: boolean } = {},
): Promise<number> {
  const all = await loadRules(tx);
  const ruleDefs = opts.ruleId ? all.filter((r) => r.id === opts.ruleId) : all;
  if (ruleDefs.length === 0) return 0;
  const rows = await tx
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      amount: transactions.amount,
      raw: transactions.rawDescription,
      merchant: merchants.name,
      categoryId: transactions.categoryId,
      reviewed: transactions.reviewed,
      excluded: transactions.excluded,
    })
    .from(transactions)
    .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
    .where(
      and(
        sql`${transactions.splitParentId} is null`,
        opts.onlyUnreviewed ? eq(transactions.reviewed, false) : undefined,
      ),
    );
  let changed = 0;
  for (const r of rows) {
    const o = applyRules(ruleDefs, {
      description: r.raw,
      merchant: r.merchant,
      amount: r.amount,
      accountId: r.accountId,
    });
    if (o.matchedRuleIds.length === 0) continue;
    const set: Partial<typeof transactions.$inferInsert> = {};
    if (o.setCategoryId !== undefined && o.setCategoryId !== r.categoryId) {
      set.categoryId = o.setCategoryId;
      set.categorySource = "rule";
    }
    if (o.markReviewed !== undefined && o.markReviewed !== r.reviewed)
      set.reviewed = o.markReviewed;
    if (o.exclude !== undefined && o.exclude !== r.excluded) set.excluded = o.exclude;
    if (o.setMerchantName) {
      const m = await resolveMerchants(tx, (await householdOf(tx)) as string, [o.setMerchantName]);
      const mid = m.get(o.setMerchantName)?.id;
      if (mid) set.merchantId = mid;
    }
    if (Object.keys(set).length === 0) continue;
    await tx.update(transactions).set(set).where(eq(transactions.id, r.id));
    changed++;
  }
  return changed;
}

async function householdOf(tx: Tx): Promise<string | null> {
  const { rows } = await tx.execute<{ id: string | null }>(sql`select app_household_id() as id`);
  return rows[0]?.id ?? null;
}
