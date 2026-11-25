import { isLiability, todayIso } from "@mm/core";
import { schema } from "@mm/db";
import {
  type Card,
  changedFields,
  computeRewards,
  DEFAULT_CATEGORY_MAP,
  quarterOf,
  REWARD_CATEGORIES,
  REWARD_CATEGORY_IDS,
  suggestCards,
} from "@mm/rewards";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { householdCatalog, shipped } from "../catalog";
import { defineOperation, OperationError } from "../operation";
import {
  centsPerPoint,
  computeHouseholdRewards,
  householdRewardsSettings,
  loadWallet,
  programName,
  RewardsSettings,
  rateSummary,
} from "../rewards";
import { DateStr, dollars, ownsAll } from "../util";

const read = { minRole: "viewer", scope: "read", readOnly: true, idempotent: true } as const;
const write = {
  minRole: "member",
  scope: "rewards:write",
  readOnly: false,
  idempotent: true,
} as const;
const RewardCategory = z.enum(REWARD_CATEGORY_IDS);

export const cardBrief = (c: Card | undefined) => {
  if (!c) return null;
  return {
    slug: c.slug,
    name: c.name,
    issuer: c.issuer,
    annualFee: c.annualFee,
    program: programName(c.program),
    rates: rateSummary(c),
  };
};

// ───────────────────────────── Reads ─────────────────────────────

export const getWallet = defineOperation({
  ...read,
  name: "get_wallet",
  title: "Wallet",
  description:
    "Credit cards in the household's wallet (each linked to a credit account), with their earn rates and rotating-category activation, plus credit accounts not linked to a card yet with suggested catalog cards.",
  input: z.object({}),
  async run(tx) {
    const [wallet, catalog] = await Promise.all([loadWallet(tx), householdCatalog(tx)]);
    const linked = new Set(wallet.map((w) => w.accountId));
    const credit = await tx
      .select({ id: schema.accounts.id, name: schema.accounts.name })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.type, "credit"), eq(schema.accounts.hidden, false)))
      .orderBy(asc(schema.accounts.sortOrder));
    const quarter = quarterOf(todayIso());
    return {
      cards: wallet.map((w) => ({
        walletCardId: w.id,
        accountId: w.accountId,
        account: w.accountName,
        ...cardBrief(w.card),
        openedOn: w.openedOn ?? null,
        ...(w.card.rotating
          ? {
              rotating: {
                quarter,
                categories: w.card.rotating[quarter] ?? [],
                activated: !!w.activations?.includes(quarter),
                activations: [...(w.activations ?? [])],
              },
            }
          : {}),
        ...(() => {
          const pick = w.card.earn.find((r) => r.pick?.mode === "user_choice")?.pick;
          return pick ? { choice: { eligible: pick.eligible, chosen: w.choices ?? [] } } : {};
        })(),
      })),
      unlinkedCreditAccounts: credit
        .filter((a) => !linked.has(a.id))
        .map((a) => ({
          accountId: a.id,
          account: a.name,
          suggestions: suggestCards(a.name, catalog.cards).map((c) => c.slug),
        })),
    };
  },
});

export const getRewardsSummary = defineOperation({
  ...read,
  name: "get_rewards_summary",
  title: "Rewards summary",
  description:
    "Points and miles earned on wallet cards between two dates, valued in dollars at the household's chosen cents-per-point, by card, by program and by reward category. Also what the best card in the wallet would have earned (`bestPossibleValue`) and the difference (`missedValue`).",
  input: z.object({ start: DateStr, end: DateStr }),
  async run(tx, _p, range) {
    const { wallet, lines } = await computeHouseholdRewards(tx, range);
    const sum = <K extends string>(key: (l: (typeof lines)[number]) => K) => {
      const m = new Map<K, { points: number; value: number; spend: number }>();
      for (const l of lines) {
        const k = key(l);
        const v = m.get(k) ?? { points: 0, value: 0, spend: 0 };
        v.points += l.points;
        v.value += l.valueCents;
        v.spend -= l.amount;
        m.set(k, v);
      }
      return [...m.entries()]
        .map(([k, v]) => ({
          key: k,
          points: v.points,
          value: dollars(v.value),
          spend: dollars(v.spend),
        }))
        .sort((a, b) => b.value - a.value);
    };
    const byCard = new Map(wallet.map((w) => [w.id, w]));
    const value = lines.reduce((s, l) => s + l.valueCents, 0);
    const best = lines.reduce((s, l) => s + Math.max(l.bestValueCents, l.valueCents), 0);
    return {
      start: range.start,
      end: range.end,
      transactions: lines.length,
      spend: dollars(-lines.reduce((s, l) => s + l.amount, 0)),
      value: dollars(value),
      bestPossibleValue: dollars(best),
      missedValue: dollars(best - value),
      byCard: sum((l) => l.walletCardId).map(({ key, ...v }) => {
        const w = byCard.get(key);
        return {
          walletCardId: key,
          card: w ? w.card.name : key,
          account: w?.accountName,
          ...v,
        };
      }),
      byProgram: sum((l) => byCard.get(l.walletCardId)?.card.program ?? "unknown").map(
        ({ key, ...v }) => ({ program: programName(key), slug: key, ...v }),
      ),
      byCategory: sum((l) => l.category).map(({ key, ...v }) => ({
        category: key,
        label: REWARD_CATEGORIES[key].label,
        ...v,
      })),
    };
  },
});

export const searchCardCatalog = defineOperation({
  ...read,
  name: "search_card_catalog",
  title: "Search card catalog",
  description:
    "Search the household's card catalog (the built-in US cards plus its own edits and custom cards) by name, issuer or program. Returns slugs, annual fees, programs and a summary of earn rates; `edited` marks entries this household has changed.",
  input: z.object({
    query: z.string().max(60).optional(),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  async run(tx, _p, { query, limit }) {
    const q = query?.toLowerCase().trim();
    const catalog = await householdCatalog(tx);
    return catalog.cards
      .filter(
        (c) =>
          !q ||
          `${c.issuer} ${c.name} ${c.program} ${programName(c.program)} ${c.aliases.join(" ")}`
            .toLowerCase()
            .includes(q),
      )
      .slice(0, limit)
      .map((c) => {
        const o = catalog.overridden.get(`card:${c.slug}`);
        return { ...cardBrief(c), ...(o ? { edited: true, custom: o.custom } : {}) };
      });
  },
});

export const getCard = defineOperation({
  ...read,
  name: "get_card",
  title: "Card details",
  description:
    "One catalog card in full: every earn rule (multiplier, categories, caps, portal-only rates, merchant rules), fees, sources and when it was last verified. If the household has edited it, `household.defaults` holds the shipped values of the fields it changed.",
  input: z.object({ slug: z.string().max(80) }),
  async run(tx, _p, { slug }) {
    const catalog = await householdCatalog(tx);
    const c = catalog.card(slug);
    if (!c) throw new OperationError("not_found", `No card "${slug}" in the catalog.`);
    const o = catalog.overridden.get(`card:${slug}`);
    const base = shipped.card(slug);
    return {
      ...c,
      programName: programName(c.program),
      rates: rateSummary(c),
      ...(o
        ? {
            household: {
              custom: o.custom,
              defaults: base
                ? Object.fromEntries(
                    changedFields(base, c).map((k) => [k, (base as Record<string, unknown>)[k]]),
                  )
                : null,
            },
          }
        : {}),
    };
  },
});

export const listRewardPrograms = defineOperation({
  ...read,
  name: "list_reward_programs",
  title: "Reward programs",
  description:
    "Points and miles programs with their floor value (cash-out or fixed redemption) and typical published value in cents per point, and the value this household uses.",
  input: z.object({}),
  async run(tx) {
    const [settings, catalog] = await Promise.all([
      householdRewardsSettings(tx),
      householdCatalog(tx),
    ]);
    return {
      valuation: settings.valuation,
      programs: catalog.programs.map((p) => {
        const base = shipped.program(p.slug);
        const edited = catalog.overridden.has(`program:${p.slug}`);
        return {
          slug: p.slug,
          name: p.name,
          kind: p.kind,
          floorCpp: p.floorCpp,
          typicalCpp: p.typicalCpp,
          usingCpp: centsPerPoint(settings, p.slug, catalog),
          custom: settings.cpp[p.slug] !== undefined,
          valuationSource: `${p.valuation.source} (${p.valuation.asOf})`,
          verifiedAt: p.verifiedAt,
          ...(edited && base
            ? { edited: true, defaultFloorCpp: base.floorCpp, defaultTypicalCpp: base.typicalCpp }
            : {}),
        };
      }),
    };
  },
});

export const listRewardCategories = defineOperation({
  ...read,
  name: "list_reward_categories",
  title: "Reward categories",
  description:
    "The reward categories card earn rates use, and how each of the household's budget categories maps onto them (explicit choices and defaults).",
  input: z.object({}),
  async run(tx) {
    const cats = await tx
      .select({
        id: schema.categories.id,
        name: schema.categories.name,
        kind: schema.categoryGroups.kind,
        mapped: schema.rewardCategoryMap.rewardCategory,
      })
      .from(schema.categories)
      .innerJoin(schema.categoryGroups, eq(schema.categoryGroups.id, schema.categories.groupId))
      .leftJoin(
        schema.rewardCategoryMap,
        eq(schema.rewardCategoryMap.categoryId, schema.categories.id),
      )
      .where(eq(schema.categoryGroups.kind, "expense"))
      .orderBy(asc(schema.categoryGroups.sortOrder), asc(schema.categories.sortOrder));
    return {
      rewardCategories: Object.entries(REWARD_CATEGORIES).map(([id, c]) => ({ id, ...c })),
      budgetCategories: cats.map((c) => ({
        categoryId: c.id,
        category: c.name,
        rewardCategory: c.mapped ?? DEFAULT_CATEGORY_MAP[c.name] ?? "everything_else",
        source: c.mapped ? "household" : DEFAULT_CATEGORY_MAP[c.name] ? "default" : "fallback",
      })),
    };
  },
});

export const bestCardFor = defineOperation({
  ...read,
  name: "best_card_for",
  title: "Best card for a purchase",
  description:
    "Which card in the wallet earns the most for a purchase in a reward category (or at a named merchant), ignoring spend caps already used. Use list_reward_categories for category ids.",
  input: z.object({
    category: RewardCategory.default("everything_else"),
    merchant: z.string().max(80).optional(),
    amount: z.number().positive().max(100_000).default(100).describe("Dollars"),
    date: DateStr.optional(),
  }),
  async run(tx, _p, i) {
    const [wallet, settings, catalog] = await Promise.all([
      loadWallet(tx),
      householdRewardsSettings(tx),
      householdCatalog(tx),
    ]);
    if (!wallet.length)
      return { ranking: [], note: "No cards in the wallet yet. Add them with set_wallet_card." };
    const date = i.date ?? todayIso();
    const ranking = wallet
      .map((w) => {
        const [e] = computeRewards({
          wallet: [w],
          valuation: (p) => centsPerPoint(settings, p, catalog),
          transactions: [
            {
              id: "hypothetical",
              accountId: w.accountId,
              date,
              amount: -Math.round(i.amount * 100),
              merchant: i.merchant ?? "",
              description: i.merchant ?? "",
              category: i.category,
            },
          ],
        });
        return {
          walletCardId: w.id,
          card: w.card.name,
          account: w.accountName,
          multiplier: e?.multiplier ?? 0,
          points: e?.points ?? 0,
          program: programName(w.card.program),
          value: dollars(e?.valueCents ?? 0),
          ...(w.card.fxFeePercent ? { foreignTransactionFeePercent: w.card.fxFeePercent } : {}),
        };
      })
      .sort((a, b) => b.value - a.value);
    return { category: i.category, amount: i.amount, ranking };
  },
});

// ───────────────────────────── Writes ─────────────────────────────

export const setWalletCard = defineOperation({
  ...write,
  name: "set_wallet_card",
  title: "Set wallet card",
  description:
    'Link a credit account (id from list_accounts) to a catalog card (slug from search_card_catalog), or pass cardSlug null to unlink. Optionally set the opening date (for cardmember-year caps), activated rotating quarters (e.g. ["2026-Q4"]) and chosen categories for choose-your-category cards.',
  input: z.object({
    accountId: z.uuid(),
    cardSlug: z.string().max(80).nullable(),
    openedOn: DateStr.nullable().optional(),
    activations: z
      .array(z.string().regex(/^\d{4}-Q[1-4]$/))
      .max(40)
      .optional(),
    choices: z.array(RewardCategory).max(5).optional(),
  }),
  async run(tx, p, i) {
    const [acct] = await tx
      .select({ type: schema.accounts.type })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, i.accountId));
    if (!acct) throw new OperationError("not_found", "That account doesn't exist.");
    if (i.cardSlug === null) {
      await tx.delete(schema.walletCards).where(eq(schema.walletCards.accountId, i.accountId));
      return { accountId: i.accountId, card: null };
    }
    const card = (await householdCatalog(tx)).card(i.cardSlug);
    if (!card) throw new OperationError("not_found", `No card "${i.cardSlug}" in the catalog.`);
    if (!isLiability(acct.type) || acct.type !== "credit")
      throw new OperationError(
        "invalid_input",
        "Only credit card accounts can be linked to a card.",
      );
    const set = {
      cardSlug: i.cardSlug,
      ...(i.openedOn !== undefined ? { openedOn: i.openedOn } : {}),
      ...(i.activations ? { activations: [...new Set(i.activations)].sort() } : {}),
      ...(i.choices ? { choices: [...new Set(i.choices)] } : {}),
    };
    await tx
      .insert(schema.walletCards)
      .values({ householdId: p.householdId, accountId: i.accountId, ...set })
      .onConflictDoUpdate({ target: schema.walletCards.accountId, set });
    return { accountId: i.accountId, card: cardBrief(card) };
  },
});

export const setRewardCategory = defineOperation({
  ...write,
  name: "set_reward_category",
  title: "Map a budget category to a reward category",
  description:
    "Choose which reward category a budget category counts as for card earn rates (e.g. 'Coffee' → dining). Pass null to go back to the default.",
  input: z.object({ categoryId: z.uuid(), rewardCategory: RewardCategory.nullable() }),
  async run(tx, p, { categoryId, rewardCategory }) {
    if (!(await ownsAll(tx, "categories", [categoryId])))
      throw new OperationError("not_found", "That category doesn't exist.");
    if (rewardCategory === null) {
      await tx
        .delete(schema.rewardCategoryMap)
        .where(eq(schema.rewardCategoryMap.categoryId, categoryId));
    } else {
      await tx
        .insert(schema.rewardCategoryMap)
        .values({ householdId: p.householdId, categoryId, rewardCategory })
        .onConflictDoUpdate({
          target: schema.rewardCategoryMap.categoryId,
          set: { rewardCategory },
        });
    }
    return { categoryId, rewardCategory };
  },
});

export const setMerchantRewardCategory = defineOperation({
  ...write,
  name: "set_merchant_reward_category",
  title: "Set a merchant's reward category",
  description:
    "Make every purchase at a merchant count as a reward category regardless of its budget category (e.g. Costco → wholesale_clubs, Walmart → superstores). Merchant by exact name as shown in transactions. Pass null to clear.",
  input: z.object({
    merchant: z.string().trim().min(1).max(120),
    rewardCategory: RewardCategory.nullable(),
  }),
  async run(tx, p, { merchant, rewardCategory }) {
    const [m] = await tx
      .select({ id: schema.merchants.id, name: schema.merchants.name })
      .from(schema.merchants)
      .where(sql`lower(${schema.merchants.name}) = lower(${merchant})`);
    if (!m) throw new OperationError("not_found", `No merchant named "${merchant}".`);
    if (rewardCategory === null) {
      await tx
        .delete(schema.merchantRewardCategories)
        .where(eq(schema.merchantRewardCategories.merchantId, m.id));
    } else {
      await tx
        .insert(schema.merchantRewardCategories)
        .values({ householdId: p.householdId, merchantId: m.id, rewardCategory })
        .onConflictDoUpdate({
          target: schema.merchantRewardCategories.merchantId,
          set: { rewardCategory },
        });
    }
    return { merchant: m.name, rewardCategory };
  },
});

export const setTransactionRewardCategory = defineOperation({
  ...write,
  name: "set_transaction_reward_category",
  title: "Set one transaction's reward category",
  description:
    "Override the reward category of a single transaction, e.g. portal_travel for a booking made through the card's travel site. Pass null to clear.",
  input: z.object({ transactionId: z.uuid(), rewardCategory: RewardCategory.nullable() }),
  async run(tx, p, { transactionId, rewardCategory }) {
    if (!(await ownsAll(tx, "transactions", [transactionId])))
      throw new OperationError("not_found", "Transaction not found.");
    if (rewardCategory === null) {
      await tx
        .delete(schema.transactionRewardOverrides)
        .where(eq(schema.transactionRewardOverrides.transactionId, transactionId));
    } else {
      await tx
        .insert(schema.transactionRewardOverrides)
        .values({ householdId: p.householdId, transactionId, rewardCategory })
        .onConflictDoUpdate({
          target: schema.transactionRewardOverrides.transactionId,
          set: { rewardCategory },
        });
    }
    return { transactionId, rewardCategory };
  },
});

export const setRewardValuation = defineOperation({
  ...write,
  name: "set_reward_valuation",
  title: "Set how points are valued",
  description:
    "Value points at each program's floor (guaranteed cash or fixed value) or typical published value, and optionally set custom cents-per-point for specific programs (null removes a custom value). Program slugs from list_reward_programs.",
  input: z.object({
    valuation: z.enum(["typical", "floor"]).optional(),
    cpp: z.record(z.string().max(40), z.number().min(0).max(10).nullable()).optional(),
  }),
  async run(tx, p, i) {
    const current = await householdRewardsSettings(tx);
    const cpp = { ...current.cpp };
    for (const [slug, v] of Object.entries(i.cpp ?? {})) {
      if (!shipped.program(slug)) throw new OperationError("not_found", `No program "${slug}".`);
      if (v === null) delete cpp[slug];
      else cpp[slug] = v;
    }
    const next = RewardsSettings.parse({
      ...current,
      valuation: i.valuation ?? current.valuation,
      cpp,
    });
    await tx
      .update(schema.households)
      .set({ rewards: next })
      .where(eq(schema.households.id, p.householdId));
    return next;
  },
});

export const REWARDS_OPERATIONS = [
  getWallet,
  getRewardsSummary,
  bestCardFor,
  searchCardCatalog,
  getCard,
  listRewardPrograms,
  listRewardCategories,
  setWalletCard,
  setRewardCategory,
  setMerchantRewardCategory,
  setTransactionRewardCategory,
  setRewardValuation,
] as const;
