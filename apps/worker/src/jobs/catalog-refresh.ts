import { type Ai, AiRefusedError, aiBudget, checkCatalogEntry, recordAiUsage } from "@mm/ai";
import { safeSendNtfy } from "@mm/connectors";
import { parseNotifySettings, todayIso } from "@mm/core";
import { type Db, schema, withHousehold } from "@mm/db";
import {
  execute,
  getCatalogStaleness,
  householdCatalog,
  OperationError,
  setProgramValuation,
  updateCard,
  workerPrincipal,
} from "@mm/services";
import { and, asc, eq, sql } from "drizzle-orm";
import { log } from "../log";
import { workerAi } from "./ai";

/**
 * Monthly, for households that turned on AI and "keep my cards up to date": check the
 * stale cards in the wallet and the programs they earn against the issuers' own pages, and
 * record what changed through the same operations an agent uses (history, undo, and the
 * household's approval setting all apply). Only public catalog data goes to the model.
 */

const STALE_AFTER_DAYS = 60;
const MAX_CARDS = 5;
const MAX_PROGRAMS = 2;

export interface RefreshSummary {
  households: number;
  checked: number;
  changed: number;
  pending: number;
}

/** Households that turned the monthly refresh on (ids only, via SECURITY DEFINER fn). */
export async function catalogRefreshHouseholds(db: Db): Promise<string[]> {
  const { rows } = await db.execute<{ id: string }>(sql`select catalog_refresh_households() as id`);
  return rows.map((r) => r.id);
}

/** Every opted-in household in one pass. The worker runs one job per household instead. */
export async function catalogRefresh(
  db: Db,
  ai: Ai | null = workerAi(),
  opts: { today?: string; fetch?: typeof fetch } = {},
): Promise<RefreshSummary> {
  const sum: RefreshSummary = { households: 0, checked: 0, changed: 0, pending: 0 };
  if (!ai) return sum;
  for (const id of await catalogRefreshHouseholds(db)) {
    try {
      const r = await catalogRefreshFor(db, id, ai, opts);
      sum.households++;
      sum.checked += r.checked;
      sum.changed += r.changed;
      sum.pending += r.pending;
    } catch (e) {
      log.warn({ householdId: id, err: (e as Error).message }, "catalog refresh: failed");
    }
  }
  log.info(sum, "catalog refresh: monthly run");
  return sum;
}

/** Check one household's stale wallet cards and programs. */
export async function catalogRefreshFor(
  db: Db,
  householdId: string,
  ai: Ai | null = workerAi(),
  opts: { today?: string; fetch?: typeof fetch } = {},
) {
  if (!ai) return { checked: 0, changed: 0, pending: 0, names: [] as string[] };
  return refreshHousehold(db, ai, householdId, opts.today ?? todayIso(), opts.fetch);
}

async function refreshHousehold(
  db: Db,
  ai: Ai,
  householdId: string,
  today: string,
  fetchImpl?: typeof fetch,
) {
  const owner = await withHousehold(db, householdId, async (tx) => {
    const [m] = await tx
      .select({ userId: schema.householdMembers.userId })
      .from(schema.householdMembers)
      .where(
        and(
          eq(schema.householdMembers.householdId, householdId),
          eq(schema.householdMembers.role, "owner"),
        ),
      )
      .orderBy(asc(schema.householdMembers.createdAt))
      .limit(1);
    return m?.userId;
  });
  const out = { checked: 0, changed: 0, pending: 0, names: [] as string[] };
  if (!owner) return out;
  const p = workerPrincipal({ userId: owner, householdId });

  const stale = await execute(db, p, getCatalogStaleness, {
    olderThanDays: STALE_AFTER_DAYS,
    walletOnly: true,
    limit: 50,
  });
  const todo = [
    ...stale.entries.filter((e) => e.entity === "card").slice(0, MAX_CARDS),
    ...stale.entries.filter((e) => e.entity === "program").slice(0, MAX_PROGRAMS),
  ];

  for (const entry of todo) {
    const budget = await withHousehold(db, householdId, (tx) => aiBudget(tx, householdId));
    if (budget.used >= budget.budget) {
      log.info({ householdId }, "catalog refresh: stopped, monthly AI token limit reached");
      break;
    }
    const current = await withHousehold(db, householdId, async (tx) => {
      const c = await householdCatalog(tx);
      return entry.entity === "card" ? c.card(entry.slug) : c.program(entry.slug);
    });
    if (!current) continue;
    // The model call runs with no database transaction open.
    let result: Awaited<ReturnType<typeof checkCatalogEntry>>;
    try {
      result = await checkCatalogEntry(ai, {
        entity: entry.entity,
        slug: entry.slug,
        current,
        sources: entry.sources,
        today,
      });
    } catch (e) {
      const why = e instanceof AiRefusedError ? "declined" : (e as Error).message;
      log.warn({ householdId, slug: entry.slug, err: why }, "catalog refresh: check failed");
      continue;
    }
    await withHousehold(db, householdId, (tx) =>
      recordAiUsage(tx, householdId, "catalog_refresh", result.usage),
    );
    out.checked++;
    const { check } = result;
    if (!check || check.outcome === "unsure") {
      log.info({ householdId, slug: entry.slug, note: check?.note }, "catalog refresh: unsure");
      continue;
    }
    const patch = check.outcome === "changed" ? (check.patch ?? {}) : {};
    try {
      const write =
        entry.entity === "card"
          ? await execute(db, p, updateCard, {
              slug: entry.slug,
              patch,
              sourceUrl: check.sourceUrl,
              asOf: today,
              note: check.note,
            })
          : await execute(db, p, setProgramValuation, {
              slug: entry.slug,
              ...(typeof patch.typicalCpp === "number" ? { typicalCpp: patch.typicalCpp } : {}),
              sourceUrl: check.sourceUrl,
              asOf: today,
              note: check.note,
            });
      const meaningful = write.changedFields.some(
        (f) => f !== "verifiedAt" && f !== "sources" && f !== "valuation",
      );
      if (write.status === "pending") out.pending++;
      else if (meaningful) out.changed++;
      if (meaningful || write.status === "pending") out.names.push(entry.name);
    } catch (e) {
      // The proposal didn't validate (bad shape or out of bounds): leave the entry alone.
      const msg = e instanceof OperationError ? e.message : (e as Error).message;
      log.warn({ householdId, slug: entry.slug, err: msg }, "catalog refresh: proposal rejected");
    }
  }

  if (out.changed || out.pending) await notify(db, householdId, out, fetchImpl);
  return out;
}

async function notify(
  db: Db,
  householdId: string,
  r: { changed: number; pending: number; names: string[] },
  fetchImpl?: typeof fetch,
) {
  const settings = await withHousehold(db, householdId, async (tx) => {
    const [h] = await tx
      .select({ n: schema.households.notifications })
      .from(schema.households)
      .where(eq(schema.households.id, householdId));
    return parseNotifySettings(h?.n);
  });
  if (!settings.ntfyUrl) return;
  const body = r.pending
    ? `${r.pending} card catalog update${r.pending === 1 ? "" : "s"} waiting for your approval in Rewards → Settings: ${r.names.join(", ")}.`
    : `Updated from issuers' pages: ${r.names.join(", ")}. Review or undo in Rewards → Settings.`;
  await safeSendNtfy(
    settings,
    { title: "Card details updated", body, priority: "default" },
    fetchImpl,
  ).catch((e) =>
    log.warn({ householdId, err: (e as Error).message }, "catalog refresh: push failed"),
  );
}
