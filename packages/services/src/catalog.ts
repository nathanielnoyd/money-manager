import { schema, type Tx } from "@mm/db";
import {
  applyOverrides,
  CATALOG,
  type Card,
  type Catalog,
  type CatalogEntity,
  type CatalogOverride,
  changedFields,
  type Program,
  resolveCard,
  resolveProgram,
} from "@mm/rewards";
import { and, eq } from "drizzle-orm";
import { OperationError, type Principal } from "./operation";

/**
 * The card catalog as one household sees it: the shipped catalog with the household's
 * overrides applied. Loaded once per database transaction and cached on it; writes in the
 * same transaction call `forgetCatalog` so later reads see them.
 */

export interface HouseholdCatalog extends Catalog {
  card(slug: string): Card | undefined;
  program(slug: string): Program | undefined;
  /** Keyed "card:slug" / "program:slug". */
  overridden: ReadonlyMap<string, { custom: boolean }>;
  /** Overrides that no longer validate against this release (ignored). */
  skipped: { entity: CatalogEntity; slug: string; error: string }[];
}

const shippedCard = new Map(CATALOG.cards.map((c) => [c.slug, c]));
const shippedProgram = new Map(CATALOG.programs.map((p) => [p.slug, p]));
export const shipped = {
  card: (slug: string) => shippedCard.get(slug),
  program: (slug: string) => shippedProgram.get(slug),
};

function build(overrides: CatalogOverride[]): HouseholdCatalog {
  const { catalog, skipped } = applyOverrides(CATALOG, overrides);
  const cards = new Map(catalog.cards.map((c) => [c.slug, c]));
  const programs = new Map(catalog.programs.map((p) => [p.slug, p]));
  const bad = new Set(skipped.map((s) => `${s.entity}:${s.slug}`));
  return {
    ...catalog,
    card: (s) => cards.get(s),
    program: (s) => programs.get(s),
    overridden: new Map(
      overrides
        .filter((o) => !bad.has(`${o.entity}:${o.slug}`))
        .map((o) => [`${o.entity}:${o.slug}`, { custom: o.custom }]),
    ),
    skipped,
  };
}

/** The catalog with no household edits. */
export const SHIPPED_CATALOG: HouseholdCatalog = build([]);

const cache = new WeakMap<Tx, Promise<HouseholdCatalog>>();

export function householdCatalog(tx: Tx): Promise<HouseholdCatalog> {
  let hit = cache.get(tx);
  if (!hit) {
    hit = tx
      .select()
      .from(schema.catalogOverrides)
      .then((rows) =>
        build(
          rows.map((r) => ({
            entity: r.entity,
            slug: r.slug,
            patch: (r.patch ?? {}) as Record<string, unknown>,
            custom: r.custom,
          })),
        ),
      );
    cache.set(tx, hit);
  }
  return hit;
}

export const forgetCatalog = (tx: Tx) => {
  cache.delete(tx);
};

// ───────────────────────────── Writes ─────────────────────────────

type Patch = Record<string, unknown>;

export interface CatalogEdit {
  entity: CatalogEntity;
  slug: string;
  action: "update" | "add" | "reset" | "revert";
  /** The override patch to store; null removes the override. */
  after: Patch | null;
  custom: boolean;
  sourceUrl?: string;
  asOf?: string;
  note?: string;
  revertsId?: string;
}

async function currentOverride(tx: Tx, entity: CatalogEntity, slug: string) {
  const [row] = await tx
    .select()
    .from(schema.catalogOverrides)
    .where(and(eq(schema.catalogOverrides.entity, entity), eq(schema.catalogOverrides.slug, slug)));
  return row ? { patch: row.patch as Patch, custom: row.custom } : null;
}

/** Validate what the entry would become; throws a message an agent can act on. */
async function validate(tx: Tx, e: Pick<CatalogEdit, "entity" | "slug" | "after" | "custom">) {
  if (e.entity === "program") {
    const base = shipped.program(e.slug);
    if (!base) throw new OperationError("not_found", `No program "${e.slug}".`);
    if (!e.after) return base;
    const r = resolveProgram(base, { slug: e.slug, patch: e.after });
    if (!r.ok) throw new OperationError("invalid_input", `That change isn't valid: ${r.error}.`);
    return r.value;
  }
  if (!e.after) return shipped.card(e.slug) ?? null;
  const catalog = await householdCatalog(tx);
  const r = resolveCard(
    shipped.card(e.slug),
    { slug: e.slug, patch: e.after, custom: e.custom },
    new Set(catalog.programs.map((p) => p.slug)),
  );
  if (!r.ok) throw new OperationError("invalid_input", `That change isn't valid: ${r.error}.`);
  return r.value;
}

async function store(tx: Tx, householdId: string, e: CatalogEdit) {
  const where = and(
    eq(schema.catalogOverrides.entity, e.entity),
    eq(schema.catalogOverrides.slug, e.slug),
  );
  if (e.after === null) await tx.delete(schema.catalogOverrides).where(where);
  else
    await tx
      .insert(schema.catalogOverrides)
      .values({ householdId, entity: e.entity, slug: e.slug, patch: e.after, custom: e.custom })
      .onConflictDoUpdate({
        target: [
          schema.catalogOverrides.householdId,
          schema.catalogOverrides.entity,
          schema.catalogOverrides.slug,
        ],
        set: { patch: e.after, custom: e.custom, updatedAt: new Date() },
      });
  if (e.revertsId)
    await tx
      .update(schema.catalogChanges)
      .set({ status: "reverted" })
      .where(eq(schema.catalogChanges.id, e.revertsId));
  forgetCatalog(tx);
}

export interface CatalogWriteResult {
  changeId: string;
  status: "applied" | "pending";
  entity: CatalogEntity;
  slug: string;
  changedFields: string[];
}

/**
 * Record a catalog edit and apply it, or leave it pending when the household requires
 * approval for edits that don't come from a person in the app.
 */
export async function writeCatalog(
  tx: Tx,
  p: Principal,
  e: CatalogEdit,
  requireApproval: boolean,
): Promise<CatalogWriteResult> {
  const before = await currentOverride(tx, e.entity, e.slug);
  const prior = e.entity === "card" ? (await householdCatalog(tx)).card(e.slug) : undefined;
  const next = await validate(tx, e);
  const pending = requireApproval && p.via !== "session";
  const [row] = await tx
    .insert(schema.catalogChanges)
    .values({
      householdId: p.householdId,
      entity: e.entity,
      slug: e.slug,
      action: e.action,
      status: pending ? "pending" : "applied",
      before: before?.patch ?? null,
      after: e.after,
      custom: e.custom,
      sourceUrl: e.sourceUrl,
      asOf: e.asOf,
      note: e.note,
      userId: p.userId || null,
      via: p.via,
      tokenId: p.tokenId,
      revertsId: e.revertsId,
    })
    .returning({ id: schema.catalogChanges.id });
  if (!pending) await store(tx, p.householdId, e);
  const was = e.entity === "card" ? prior : shipped.program(e.slug);
  return {
    changeId: row?.id ?? "",
    status: pending ? "pending" : "applied",
    entity: e.entity,
    slug: e.slug,
    changedFields: next && was ? changedFields(was, next) : changedFields({}, e.after ?? {}),
  };
}

const changes = schema.catalogChanges;

export async function loadChange(tx: Tx, id: string) {
  const [row] = await tx.select().from(changes).where(eq(changes.id, id));
  if (!row) throw new OperationError("not_found", "That catalog change doesn't exist.");
  return row;
}

/** Approve or reject a pending change. Approval fails if the entry changed since it was proposed. */
export async function decideChange(
  tx: Tx,
  p: Principal,
  id: string,
  decision: "approve" | "reject",
): Promise<{ changeId: string; status: "applied" | "rejected" }> {
  const row = await loadChange(tx, id);
  if (row.status !== "pending")
    throw new OperationError("conflict", "That change isn't waiting for approval.");
  const decided = { decidedBy: p.userId, decidedAt: new Date() };
  if (decision === "reject") {
    await tx
      .update(changes)
      .set({ status: "rejected", ...decided })
      .where(eq(changes.id, id));
    return { changeId: id, status: "rejected" };
  }
  const now = await currentOverride(tx, row.entity, row.slug);
  if (JSON.stringify(now?.patch ?? null) !== JSON.stringify(row.before ?? null))
    throw new OperationError(
      "conflict",
      "This entry has changed since the proposal was made. Reject it and ask for a fresh one.",
    );
  const edit: CatalogEdit = {
    entity: row.entity,
    slug: row.slug,
    action: row.action,
    after: (row.after as Patch | null) ?? null,
    custom: row.custom,
    revertsId: row.revertsId ?? undefined,
  };
  await validate(tx, edit);
  await store(tx, p.householdId, edit);
  await tx
    .update(changes)
    .set({ status: "applied", ...decided })
    .where(eq(changes.id, id));
  return { changeId: id, status: "applied" };
}

/**
 * The edit that undoes an applied change. Allowed while the entry is still what that change
 * left it as, so changes are undone newest first.
 */
export async function revertEdit(tx: Tx, id: string): Promise<CatalogEdit> {
  const row = await loadChange(tx, id);
  if (row.status !== "applied")
    throw new OperationError(
      "conflict",
      `That change is ${row.status}, so there's nothing to undo.`,
    );
  const now = await currentOverride(tx, row.entity, row.slug);
  if (JSON.stringify(now?.patch ?? null) !== JSON.stringify(row.after ?? null))
    throw new OperationError(
      "conflict",
      "A later change to this entry is in place. Undo that one first, or reset the entry.",
    );
  const before = (row.before as Patch | null) ?? null;
  // Undoing the change that added a custom card removes the card.
  return {
    entity: row.entity,
    slug: row.slug,
    action: "revert",
    after: before,
    custom: before ? row.custom : false,
    revertsId: row.id,
  };
}
