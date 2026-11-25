import { z } from "zod";
import { REWARD_CATEGORY_IDS } from "./categories";

/**
 * The card and points catalog format. The shipped catalog lives in ../catalog as JSON
 * (one file per issuer under cards/, plus programs.json), generated from Open Credit Card
 * Benefits by `pnpm --filter @mm/rewards catalog:import`, and is validated against these
 * schemas in CI (`pnpm --filter @mm/rewards catalog:validate`).
 *
 * Conventions
 * - Earn rates are points (or miles) per dollar. Cash back is modeled as the `cash_back`
 *   program worth 1¢ per point, so 2% cash back is a multiplier of 2.
 * - Every card and program cites sources (issuer pages where OCCB has them, else the reviews
 *   it cites; the named publisher for valuations) and the date someone last checked them.
 */

const Slug = z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, "lower_snake_case");
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Source = z.object({
  url: z.url().refine((u) => u.startsWith("https://"), "https only"),
  title: z.string().max(200).optional(),
});
const Category = z.enum(REWARD_CATEGORY_IDS);

export const CapPeriod = z.enum(["month", "quarter", "calendar_year", "cardmember_year"]);
export type CapPeriod = z.infer<typeof CapPeriod>;

export const EarnRule = z
  .object({
    /** Reward categories this rate applies to. Empty with `merchants` = merchant-only rule. */
    categories: z.array(Category).default([]),
    /**
     * Case-insensitive substrings matched against the merchant name and bank description,
     * for rates tied to specific merchants ("purchases made directly with Delta").
     */
    merchants: z.array(z.string().min(2).max(60)).max(30).optional(),
    /** Merchants that never earn this rate even when the category matches. */
    excludeMerchants: z.array(z.string().min(2).max(60)).max(30).optional(),
    multiplier: z.number().positive().max(25),
    /** Spend cap in dollars for this rate, shared across all its categories. */
    cap: z.object({ amount: z.number().positive(), period: CapPeriod }).optional(),
    /** Rate once the cap is reached; defaults to the card's base rate. */
    afterCap: z.number().min(0).max(25).optional(),
    /** "portal": only for bookings through the issuer's travel site (category portal_travel). */
    channel: z.enum(["any", "portal"]).default("any"),
    /** Quarterly rotating categories: the categories come from the card's `rotating` table. */
    rotating: z.boolean().optional(),
    /**
     * Rates whose category is chosen: "top_spend" applies to whichever eligible category
     * had the most spend in the cap period (Citi Custom Cash); "user_choice" to the one the
     * cardholder picked (stored on the wallet card).
     */
    pick: z
      .object({
        mode: z.enum(["top_spend", "user_choice"]),
        eligible: z.array(Category).min(1),
      })
      .optional(),
    /** Date range the rate applies, for limited-time rates. */
    validFrom: IsoDate.optional(),
    validTo: IsoDate.optional(),
    note: z.string().max(300).optional(),
  })
  .refine((r) => r.categories.length > 0 || r.merchants?.length || r.rotating || r.pick, {
    message: "A rule needs categories, merchants, rotating or pick",
  });
export type EarnRule = z.infer<typeof EarnRule>;

export const Card = z.object({
  slug: Slug,
  issuer: z.string().min(2).max(60),
  name: z.string().min(2).max(100),
  /** "other": the issuer picks the network per card (Capital One Spark Cash Plus). */
  network: z.enum(["visa", "mastercard", "amex", "discover", "other"]),
  /** Dollars per year. */
  annualFee: z.number().min(0).max(10_000),
  /** Program slug from programs.json. */
  program: Slug,
  /** Foreign transaction fee, percent. */
  fxFeePercent: z.number().min(0).max(5),
  /** Points per dollar on everything without a better rate. */
  base: z.number().min(0).max(10),
  earn: z.array(EarnRule).max(20),
  /** For rotating-category cards: categories per quarter, keyed "YYYY-Qn". */
  rotating: z.record(z.string().regex(/^\d{4}-Q[1-4]$/), z.array(Category).min(1)).optional(),
  business: z.boolean().default(false),
  /** Extra names to match against bank account names when suggesting a card. */
  aliases: z.array(z.string().min(2).max(100)).max(10).default([]),
  sources: z.array(Source).min(1).max(10),
  verifiedAt: IsoDate,
  notes: z.string().max(1000).optional(),
});
export type Card = z.infer<typeof Card>;

export const Program = z
  .object({
    slug: Slug,
    name: z.string().min(2).max(100),
    kind: z.enum(["transferable", "airline", "hotel", "cash_back"]),
    unit: z.enum(["points", "miles", "cash"]),
    /** Cents per point you can always get (cash out, statement credit or fixed portal value). */
    floorCpp: z.number().min(0).max(5),
    floorNote: z.string().max(300),
    /** Cents per point from the cited published valuation. */
    typicalCpp: z.number().min(0).max(5),
    valuation: z.object({ source: z.string().max(100), url: z.url(), asOf: IsoDate }),
    verifiedAt: IsoDate,
  })
  .refine((p) => p.typicalCpp >= p.floorCpp, { message: "typicalCpp must be ≥ floorCpp" });
export type Program = z.infer<typeof Program>;

export const CardFile = z.object({ cards: z.array(Card).min(1) });
export const ProgramFile = z.object({ programs: z.array(Program).min(1) });
