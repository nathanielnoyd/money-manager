import type { Catalog } from "./catalog";
import { checkCard } from "./catalog";
import { Card, Program } from "./schema";

/**
 * Household edits to the catalog. A household (or its agent) can patch top-level fields of
 * a shipped card or program, or add a whole card the catalog doesn't have (`custom`). The
 * effective catalog is the shipped one with the patches applied, so an app upgrade
 * refreshes the defaults while the household's edits keep winning until it resets them.
 */

export type CatalogEntity = "card" | "program";

export interface CatalogOverride {
  entity: CatalogEntity;
  slug: string;
  patch: Record<string, unknown>;
  custom: boolean;
}

/** Card fields an override may set. `slug` is fixed; `sources` and `verifiedAt` come with every edit. */
export const CARD_PATCH_FIELDS = [
  "issuer",
  "name",
  "network",
  "annualFee",
  "program",
  "fxFeePercent",
  "base",
  "earn",
  "rotating",
  "business",
  "aliases",
  "notes",
  "sources",
  "verifiedAt",
] as const;

/** Program fields an override may set: values only. Names and kinds come from the release. */
export const PROGRAM_PATCH_FIELDS = [
  "floorCpp",
  "floorNote",
  "typicalCpp",
  "valuation",
  "verifiedAt",
] as const;

const pick = (o: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => keys.includes(k)));

export type Resolved<T> = { ok: true; value: T } | { ok: false; error: string };

const issue = (e: { issues: { path: PropertyKey[]; message: string }[] }) => {
  const i = e.issues[0];
  return i ? `${i.path.map(String).join(".") || "card"}: ${i.message}` : "invalid";
};

/** A card with a patch applied (or a custom card), validated against the catalog schema. */
export function resolveCard(
  base: Card | undefined,
  o: Pick<CatalogOverride, "slug" | "patch" | "custom">,
  programs: ReadonlySet<string>,
): Resolved<Card> {
  if (!base && !o.custom) return { ok: false, error: `no card "${o.slug}" in the catalog` };
  const merged = { ...(base ?? {}), ...pick(o.patch, CARD_PATCH_FIELDS), slug: o.slug };
  const r = Card.safeParse(merged);
  if (!r.success) return { ok: false, error: issue(r.error) };
  const problems = checkCard(r.data, programs);
  if (problems.length) return { ok: false, error: problems.join("; ") };
  return { ok: true, value: r.data };
}

/** A program with a value patch applied, validated (typical ≥ floor, cents within bounds). */
export function resolveProgram(
  base: Program | undefined,
  o: Pick<CatalogOverride, "slug" | "patch">,
): Resolved<Program> {
  if (!base) return { ok: false, error: `no program "${o.slug}"` };
  const r = Program.safeParse({ ...base, ...pick(o.patch, PROGRAM_PATCH_FIELDS), slug: o.slug });
  return r.success ? { ok: true, value: r.data } : { ok: false, error: issue(r.error) };
}

/**
 * Apply a household's overrides to the shipped catalog. An override that no longer fits
 * (say a release renamed a program) is skipped and reported rather than breaking the page.
 */
export function applyOverrides(
  base: Catalog,
  overrides: readonly CatalogOverride[],
): { catalog: Catalog; skipped: { entity: CatalogEntity; slug: string; error: string }[] } {
  const skipped: { entity: CatalogEntity; slug: string; error: string }[] = [];
  const programs = base.programs.map((p) => {
    const o = overrides.find((x) => x.entity === "program" && x.slug === p.slug);
    if (!o) return p;
    const r = resolveProgram(p, o);
    if (r.ok) return r.value;
    skipped.push({ entity: "program", slug: p.slug, error: r.error });
    return p;
  });
  const known = new Set(programs.map((p) => p.slug));
  for (const o of overrides)
    if (o.entity === "program" && !known.has(o.slug))
      skipped.push({ entity: "program", slug: o.slug, error: "no such program" });

  const shipped = new Map(base.cards.map((c) => [c.slug, c]));
  const out = new Map(base.cards.map((c) => [c.slug, c]));
  for (const o of overrides) {
    if (o.entity !== "card") continue;
    const r = resolveCard(shipped.get(o.slug), o, known);
    if (r.ok) out.set(o.slug, r.value);
    else skipped.push({ entity: "card", slug: o.slug, error: r.error });
  }
  return { catalog: { programs, cards: [...out.values()] }, skipped };
}

/** Top-level fields that differ between two versions of an entry. */
export function changedFields(a: object | undefined, b: object): string[] {
  const x = (a ?? {}) as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  return [...new Set([...Object.keys(x), ...Object.keys(y)])]
    .filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k]))
    .sort();
}
