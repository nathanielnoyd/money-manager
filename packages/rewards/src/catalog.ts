import type { Card, Program } from "./schema";

export interface Catalog {
  programs: Program[];
  cards: Card[];
}

/** Provenance of the shipped catalog (catalog/SOURCE.json), written by the OCCB importer. */
export interface CatalogSource {
  dataset: string;
  url: string;
  license: string;
  attribution: string;
  /** Commit of the Open Credit Card Benefits checkout the catalog was built from. */
  commit: string | null;
  /** Terms are those for someone applying on this date. */
  asOf: string;
  /** Points valuations file, relative to the checkout. */
  valuations: string;
  counts: { cards: number; programs: number; issuers: number };
}

/** Cross-file checks the per-file schemas can't express. */
export function checkCatalog({ programs, cards }: Catalog): string[] {
  const out: string[] = [];
  const dup = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);
  for (const s of dup(programs.map((p) => p.slug))) out.push(`duplicate program ${s}`);
  for (const s of dup(cards.map((c) => c.slug))) out.push(`duplicate card ${s}`);
  const known = new Set(programs.map((p) => p.slug));
  for (const c of cards) out.push(...checkCard(c, known).map((m) => `${c.slug}: ${m}`));
  return out;
}

/** Checks on one card that need the rest of the catalog (its program must exist). */
export function checkCard(c: Card, programs: ReadonlySet<string>): string[] {
  const out: string[] = [];
  if (!programs.has(c.program)) out.push(`unknown program ${c.program}`);
  if (c.earn.some((r) => r.rotating) && !c.rotating)
    out.push("rotating rule but no rotating table");
  if (c.program === "cash_back" && (c.base > 10 || c.earn.some((r) => r.multiplier > 10)))
    out.push("cash back over 10% looks wrong");
  return out;
}
