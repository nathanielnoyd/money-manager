import { addDays, todayIso } from "@mm/core";
import { schema } from "@mm/db";
import { CARD_FILE_OF, Card, changedFields } from "@mm/rewards";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { decideChange, householdCatalog, revertEdit, shipped, writeCatalog } from "../catalog";
import { defineOperation, OperationError, type Principal } from "../operation";
import { householdRewardsSettings, loadWallet, RewardsSettings } from "../rewards";
import { DateStr } from "../util";

/**
 * Keeping the card catalog current. Agents (or the built-in refresher) check issuer pages
 * and record what changed, always with a source. Every edit is kept in history, can be
 * undone, and can be held for a person's approval.
 */

const read = { minRole: "viewer", scope: "read", readOnly: true, idempotent: true } as const;
const edit = {
  minRole: "member",
  scope: "rewards:catalog",
  readOnly: false,
  idempotent: false,
} as const;

const SourceUrl = z
  .url()
  .max(500)
  .refine((u) => u.startsWith("https://"), "Use an https:// link")
  .describe("The page you checked: the issuer's own card page for rates and fees");
const AsOf = DateStr.describe("The date you checked the source, YYYY-MM-DD");
const Note = z.string().trim().max(300).optional().describe("What changed, in a sentence");

const CardFields = Card.pick({
  issuer: true,
  name: true,
  network: true,
  annualFee: true,
  program: true,
  fxFeePercent: true,
  base: true,
  earn: true,
  rotating: true,
  business: true,
  aliases: true,
  notes: true,
});

/** Edits name only what changed: no defaults, so a patch never resets fields it didn't mention. */
const CardPatch = CardFields.partial()
  .extend({
    business: z.boolean().optional(),
    aliases: z.array(z.string().min(2).max(100)).max(10).optional(),
  })
  .strict();

async function approvalRequired(tx: Parameters<typeof householdRewardsSettings>[0]) {
  return (await householdRewardsSettings(tx)).requireCatalogApproval;
}

/** Put the checked source first, keep the others (at most 10). */
function withSource(current: { url: string; title?: string }[], url: string) {
  return [{ url }, ...current.filter((s) => s.url !== url)].slice(0, 10);
}

const outcome = (r: Awaited<ReturnType<typeof writeCatalog>>) => ({
  ...r,
  message:
    r.status === "pending"
      ? "Saved as a proposal. A person in the household needs to approve it in the app."
      : r.changedFields.filter((f) => f !== "verifiedAt" && f !== "sources").length
        ? "Applied. It can be undone with revert_catalog_change."
        : "Recorded as checked: no values changed.",
});

// ───────────────────────────── Reads ─────────────────────────────

export const getCatalogStaleness = defineOperation({
  ...read,
  name: "get_catalog_staleness",
  title: "Catalog entries to re-check",
  description:
    "The work list for keeping the card catalog current: cards and points programs last verified more than `olderThanDays` ago, with the pages to check. Cards in the wallet and the programs they earn come first, then the rest of the catalog. Use with update_card and set_program_valuation.",
  input: z.object({
    olderThanDays: z.number().int().min(0).max(3650).default(90),
    limit: z.number().int().min(1).max(100).default(20),
    walletOnly: z.boolean().default(false),
  }),
  async run(tx, _p, i) {
    const [catalog, wallet] = await Promise.all([householdCatalog(tx), loadWallet(tx)]);
    const today = todayIso();
    const cutoff = addDays(today, -i.olderThanDays);
    const days = (d: string) => Math.round((Date.parse(today) - Date.parse(d)) / 86_400_000);
    const inWallet = new Set(wallet.map((w) => w.card.slug));
    const walletPrograms = new Set(wallet.map((w) => w.card.program));
    const cards = catalog.cards
      .filter((c) => c.verifiedAt <= cutoff && (!i.walletOnly || inWallet.has(c.slug)))
      .map((c) => ({
        entity: "card" as const,
        slug: c.slug,
        name: c.name.startsWith(c.issuer) ? c.name : `${c.issuer} ${c.name}`,
        verifiedAt: c.verifiedAt,
        daysSinceVerified: days(c.verifiedAt),
        inWallet: inWallet.has(c.slug),
        edited: catalog.overridden.has(`card:${c.slug}`),
        sources: c.sources.map((s) => s.url),
      }));
    const programs = catalog.programs
      .filter(
        (p) =>
          p.slug !== "cash_back" &&
          p.verifiedAt <= cutoff &&
          (!i.walletOnly || walletPrograms.has(p.slug)),
      )
      .map((p) => ({
        entity: "program" as const,
        slug: p.slug,
        name: p.name,
        verifiedAt: p.verifiedAt,
        daysSinceVerified: days(p.verifiedAt),
        inWallet: walletPrograms.has(p.slug),
        edited: catalog.overridden.has(`program:${p.slug}`),
        sources: [p.valuation.url],
        valuationSource: p.valuation.source,
      }));
    const all = [...cards, ...programs].sort(
      (a, b) =>
        Number(b.inWallet) - Number(a.inWallet) || b.daysSinceVerified - a.daysSinceVerified,
    );
    return {
      today,
      olderThanDays: i.olderThanDays,
      total: all.length,
      entries: all.slice(0, i.limit),
    };
  },
});

export const listCatalogChanges = defineOperation({
  ...read,
  name: "list_catalog_changes",
  title: "Catalog change history",
  description:
    "Edits to the household's card catalog, newest first: who or what made them (person, agent token or the built-in refresher), the source, the fields changed, and whether each is applied, pending approval, rejected or reverted.",
  input: z.object({
    status: z.enum(["applied", "pending", "rejected", "reverted"]).optional(),
    slug: z.string().max(80).optional(),
    limit: z.number().int().min(1).max(100).default(30),
  }),
  async run(tx, _p, i) {
    const c = schema.catalogChanges;
    const rows = await tx
      .select({
        id: c.id,
        entity: c.entity,
        slug: c.slug,
        action: c.action,
        status: c.status,
        before: c.before,
        after: c.after,
        custom: c.custom,
        sourceUrl: c.sourceUrl,
        asOf: c.asOf,
        note: c.note,
        via: c.via,
        createdAt: c.createdAt,
        decidedAt: c.decidedAt,
        by: schema.users.displayName,
      })
      .from(c)
      .leftJoin(schema.users, eq(schema.users.id, c.userId))
      .where(
        and(i.status ? eq(c.status, i.status) : undefined, i.slug ? eq(c.slug, i.slug) : undefined),
      )
      .orderBy(desc(c.createdAt), desc(c.id))
      .limit(i.limit);
    return {
      changes: rows.map((r) => {
        const base = r.entity === "card" ? shipped.card(r.slug) : shipped.program(r.slug);
        const name =
          r.entity === "card"
            ? (base?.name ?? ((r.after ?? r.before) as { name?: string } | null)?.name ?? r.slug)
            : (base?.name ?? r.slug);
        return {
          changeId: r.id,
          entity: r.entity,
          slug: r.slug,
          name,
          action: r.action,
          status: r.status,
          custom: r.custom,
          fields: changedFields(r.before ?? {}, r.after ?? {}).filter(
            (f) =>
              r.action === "reset" ||
              r.action === "revert" ||
              (f !== "sources" && f !== "verifiedAt"),
          ),
          before: r.before,
          after: r.after,
          sourceUrl: r.sourceUrl,
          asOf: r.asOf,
          note: r.note,
          via: r.via,
          by: r.via === "worker" ? "Built-in refresher" : (r.by ?? null),
          at: r.createdAt.toISOString(),
        };
      }),
    };
  },
});

interface PatchEntry {
  entity: "card" | "program";
  slug: string;
  /** Path under packages/rewards/catalog. */
  file: string;
  action: "add" | "update";
  fields: string[];
  entry: unknown;
}

export const exportCatalogPatch = defineOperation({
  ...read,
  name: "export_catalog_patch",
  title: "Export catalog edits for upstream",
  description:
    "The household's applied catalog edits as full catalog entries, with the generated file each one corresponds to under packages/rewards/catalog. The shipped catalog is generated from Open Credit Card Benefits, so a fix everyone should get belongs there (github.com/nathanielnoyd/open-credit-card-benefits), citing the sources; Money Manager picks it up on the next import. Contains public card data only, no household data.",
  input: z.object({}),
  async run(tx) {
    const catalog = await householdCatalog(tx);
    const entries = [...catalog.overridden.entries()].flatMap(([key, o]): PatchEntry[] => {
      const [entity, slug] = key.split(":") as ["card" | "program", string];
      if (entity === "program") {
        const p = catalog.program(slug);
        const base = shipped.program(slug);
        return p
          ? [
              {
                entity,
                slug,
                file: "programs.json",
                action: "update",
                fields: changedFields(base, p),
                entry: p,
              },
            ]
          : [];
      }
      const c = catalog.card(slug);
      if (!c) return [];
      const base = shipped.card(slug);
      const file =
        CARD_FILE_OF.get(slug) ??
        `cards/${c.issuer
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")}.json`;
      return [
        {
          entity,
          slug,
          file,
          action: o.custom && !base ? "add" : "update",
          fields: changedFields(base, c),
          entry: c,
        },
      ];
    });
    return {
      entries,
      howTo:
        "Money Manager's catalog files are generated from Open Credit Card Benefits; don't edit them by hand. Propose each correction to github.com/nathanielnoyd/open-credit-card-benefits with the sources you checked, then re-import with `pnpm --filter @mm/rewards catalog:import` (see .claude/skills/import-card-catalog). The file named in each entry is where the imported card or program will land.",
    };
  },
});

// ───────────────────────────── Edits ─────────────────────────────

export const updateCard = defineOperation({
  ...edit,
  name: "update_card",
  title: "Update a catalog card",
  description:
    "Correct a card in the household's catalog after checking the issuer's own page: annual fee, earn rules (the whole `earn` list replaces the old one), base rate, rotating categories and so on. Annual fee in dollars; multipliers are points per dollar (or percent for cash back). Always pass the page you checked as sourceUrl and the date as asOf. Pass an empty patch to record that you checked and nothing changed. Changes are kept in history and can be undone; if the household requires approval, they wait as proposals.",
  input: z.object({
    slug: z.string().max(80),
    patch: CardPatch,
    sourceUrl: SourceUrl,
    asOf: AsOf,
    note: Note,
  }),
  async run(tx, p: Principal, i) {
    const catalog = await householdCatalog(tx);
    const current = catalog.card(i.slug);
    if (!current) throw new OperationError("not_found", `No card "${i.slug}" in the catalog.`);
    if (i.asOf > todayIso())
      throw new OperationError("invalid_input", "asOf can't be in the future.");
    const o = catalog.overridden.get(`card:${i.slug}`);
    const [row] = await tx
      .select({ patch: schema.catalogOverrides.patch })
      .from(schema.catalogOverrides)
      .where(
        and(eq(schema.catalogOverrides.entity, "card"), eq(schema.catalogOverrides.slug, i.slug)),
      );
    const prev = o ? ((row?.patch ?? {}) as Record<string, unknown>) : {};
    const after = {
      ...prev,
      ...i.patch,
      sources: withSource(current.sources, i.sourceUrl),
      verifiedAt: i.asOf,
    };
    return outcome(
      await writeCatalog(
        tx,
        p,
        {
          entity: "card",
          slug: i.slug,
          action: "update",
          after,
          custom: o?.custom ?? false,
          sourceUrl: i.sourceUrl,
          asOf: i.asOf,
          note: i.note,
        },
        await approvalRequired(tx),
      ),
    );
  },
});

export const addCustomCard = defineOperation({
  ...edit,
  name: "add_custom_card",
  title: "Add a card the catalog doesn't have",
  description:
    "Add a card (a credit union card, say) to this household's catalog so it can be linked in the wallet with set_wallet_card. Give every field, earn rules as on the issuer's page, and the program slug from list_reward_programs (cash_back for cash back, where a multiplier of 2 means 2%). Annual fee in dollars.",
  input: CardFields.extend({
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, "lower_snake_case")
      .max(60)
      .describe("A new lower_snake_case id, e.g. alliant_cashback_visa"),
    sourceUrl: SourceUrl,
    asOf: AsOf,
    note: Note,
  }),
  async run(tx, p, { slug, sourceUrl, asOf, note, ...fields }) {
    const catalog = await householdCatalog(tx);
    if (catalog.card(slug))
      throw new OperationError("conflict", `"${slug}" is already in the catalog. Use update_card.`);
    if (catalog.overridden.size >= 200)
      throw new OperationError("invalid_input", "This household has reached 200 catalog edits.");
    return outcome(
      await writeCatalog(
        tx,
        p,
        {
          entity: "card",
          slug,
          action: "add",
          after: { ...fields, sources: [{ url: sourceUrl }], verifiedAt: asOf },
          custom: true,
          sourceUrl,
          asOf,
          note,
        },
        await approvalRequired(tx),
      ),
    );
  },
});

export const setProgramValuation = defineOperation({
  ...edit,
  name: "set_program_valuation",
  title: "Update a program's point values",
  description:
    "Update a points program's values in cents per point: the floor (what you can always get, like cash out) and the typical published value (from the household's chosen publisher, The Points Guy by default). Cash back can't be changed. Pass the page you checked as sourceUrl. This changes the catalog default; set_reward_valuation sets the household's own custom value instead.",
  input: z.object({
    slug: z.string().max(40),
    floorCpp: z.number().min(0).max(5).optional(),
    floorNote: z.string().max(300).optional(),
    typicalCpp: z.number().min(0.1).max(5).optional(),
    valuationSource: z.string().max(100).optional().describe("Publisher name, e.g. The Points Guy"),
    sourceUrl: SourceUrl,
    asOf: AsOf,
    note: Note,
  }),
  async run(tx, p, i) {
    if (i.slug === "cash_back" || !shipped.program(i.slug))
      throw new OperationError("not_found", `No points program "${i.slug}".`);
    if (i.asOf > todayIso())
      throw new OperationError("invalid_input", "asOf can't be in the future.");
    const catalog = await householdCatalog(tx);
    const current = catalog.program(i.slug);
    const [row] = await tx
      .select({ patch: schema.catalogOverrides.patch })
      .from(schema.catalogOverrides)
      .where(
        and(
          eq(schema.catalogOverrides.entity, "program"),
          eq(schema.catalogOverrides.slug, i.slug),
        ),
      );
    const valueChanged = i.typicalCpp !== undefined || i.floorCpp !== undefined;
    const after = {
      ...((row?.patch ?? {}) as Record<string, unknown>),
      ...(i.floorCpp !== undefined ? { floorCpp: i.floorCpp } : {}),
      ...(i.floorNote !== undefined ? { floorNote: i.floorNote } : {}),
      ...(i.typicalCpp !== undefined ? { typicalCpp: i.typicalCpp } : {}),
      ...(valueChanged || i.valuationSource
        ? {
            valuation: {
              source: i.valuationSource ?? current?.valuation.source ?? "Unknown",
              url: i.sourceUrl,
              asOf: i.asOf,
            },
          }
        : {}),
      verifiedAt: i.asOf,
    };
    return outcome(
      await writeCatalog(
        tx,
        p,
        {
          entity: "program",
          slug: i.slug,
          action: "update",
          after,
          custom: false,
          sourceUrl: i.sourceUrl,
          asOf: i.asOf,
          note: i.note,
        },
        await approvalRequired(tx),
      ),
    );
  },
});

export const revertCatalogChange = defineOperation({
  ...edit,
  name: "revert_catalog_change",
  title: "Undo a catalog change",
  description:
    "Undo an applied catalog change (changeId from list_catalog_changes), restoring the entry to what it was before. A change can be undone while the entry is still as that change left it; undo newer changes first.",
  input: z.object({ changeId: z.uuid() }),
  async run(tx, p, { changeId }) {
    const e = await revertEdit(tx, changeId);
    return outcome(await writeCatalog(tx, p, e, await approvalRequired(tx)));
  },
});

export const resetCatalogEntry = defineOperation({
  ...edit,
  destructive: true,
  name: "reset_catalog_entry",
  title: "Reset a catalog entry to the default",
  description:
    "Drop all of the household's edits to a card or program so it uses the values shipped with the app again. For a custom card this removes it. Recorded in history, so it can be undone.",
  input: z.object({ entity: z.enum(["card", "program"]), slug: z.string().max(80) }),
  async run(tx, p, { entity, slug }) {
    const catalog = await householdCatalog(tx);
    const o = catalog.overridden.get(`${entity}:${slug}`);
    if (!o) throw new OperationError("not_found", "That entry has no edits to reset.");
    return outcome(
      await writeCatalog(
        tx,
        p,
        { entity, slug, action: "reset", after: null, custom: false },
        await approvalRequired(tx),
      ),
    );
  },
});

// ───────────────────── People only (never agents) ─────────────────────

export const reviewCatalogChange = defineOperation({
  ...edit,
  sessionOnly: true,
  name: "review_catalog_change",
  title: "Approve or reject a catalog proposal",
  description:
    "Approve or reject a pending catalog change. Only people signed in to the app can do this.",
  input: z.object({ changeId: z.uuid(), decision: z.enum(["approve", "reject"]) }),
  async run(tx, p, { changeId, decision }) {
    return decideChange(tx, p, changeId, decision);
  },
});

export const setCatalogApproval = defineOperation({
  ...edit,
  minRole: "owner",
  sessionOnly: true,
  idempotent: true,
  name: "set_catalog_approval",
  title: "Require approval for agent catalog edits",
  description: "Whether agent and refresher edits to the catalog wait for a person's approval.",
  input: z.object({ required: z.boolean() }),
  async run(tx, p, { required }) {
    const current = await householdRewardsSettings(tx);
    const next = RewardsSettings.parse({ ...current, requireCatalogApproval: required });
    await tx
      .update(schema.households)
      .set({ rewards: next })
      .where(eq(schema.households.id, p.householdId));
    return { requireCatalogApproval: required };
  },
});

export const CATALOG_OPERATIONS = [
  getCatalogStaleness,
  listCatalogChanges,
  exportCatalogPatch,
  updateCard,
  addCustomCard,
  setProgramValuation,
  revertCatalogChange,
  resetCatalogEntry,
  reviewCatalogChange,
  setCatalogApproval,
] as const;
