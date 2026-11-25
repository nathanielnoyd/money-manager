import { REWARD_CATEGORIES, REWARD_CATEGORY_IDS, type RewardCategory } from "../categories";
import type { CapPeriod, Card, EarnRule, Program } from "../schema";

/**
 * Converts Open Credit Card Benefits (OCCB) catalog records into Money Manager's catalog
 * format. Everything here is pure: the CLI (import-occb.ts) reads the YAML and writes files.
 *
 * OCCB is richer than this app's format: versioned terms, shared caps, stacking and boost
 * rules, status credits, a hierarchical spend taxonomy. What doesn't fit is dropped or
 * approximated, never guessed, and each such decision is returned as a sentence that goes
 * into the card's `notes` and the importer's report.
 */

// ───────────────────────────── OCCB input (only the fields we read) ─────────────────────────────

export interface OccbSource {
  url: string;
  retrieved_at?: string;
  publisher?: string;
  title?: string;
}
export interface OccbCondition {
  type: string;
  note?: string;
  [k: string]: unknown;
}
export interface OccbMoney {
  amount: number;
  currency: string;
}
export interface OccbSchedule {
  from: string;
  to: string;
  categories: string[];
}
export interface OccbEarnVersion {
  version: number;
  release: string;
  multiplier?: string;
  boost?: string;
  currency?: string;
  stacks?: boolean;
  cap?: OccbMoney;
  cap_period?: string;
  cap_group?: string;
  channel?: string;
  conditions?: OccbCondition[];
  schedule?: OccbSchedule[];
  effective_from?: string;
  effective_to?: string;
  notes?: string;
  sources?: OccbSource[];
}
export interface OccbChoice {
  mode: "holder_selects" | "top_spend" | "rotating";
  pick?: number;
  selection?: string;
  period?: string;
  groups?: { id: string; name?: string; categories: string[] }[];
}
export interface OccbEarnRule {
  id: string;
  name?: string;
  categories: string[];
  exclude_categories?: string[];
  choice?: OccbChoice;
  versions: OccbEarnVersion[];
  based_on?: string;
}
export interface OccbBenefitVersion {
  version: number;
  release: string;
  waives?: string;
  grants?: { entitlement: string }[];
  effective_from?: string | null;
  effective_to?: string;
  supersedes?: number;
  change_type?: string;
  [k: string]: unknown;
}
export interface OccbBenefit {
  id: string;
  card_id?: string;
  kind: string;
  name: string;
  versions: OccbBenefitVersion[];
  based_on?: string;
}
export interface OccbChange {
  target: string;
  version?: number;
  change_type?: string;
  to?: OccbMoney;
  rate?: string;
}
export interface OccbRelease {
  id: string;
  card_id: string;
  kind: string;
  effective_for_new: string;
  follows?: string;
  changes: OccbChange[];
  transition?: { applies_to: string[]; [k: string]: unknown }[];
  sources?: OccbSource[];
  notes?: string;
  announced_on?: string;
  first_seen_on?: string;
  [k: string]: unknown;
}
export interface OccbCard {
  id: string;
  issuer_id: string;
  name: string;
  summary?: string;
  network?: string;
  segment?: string;
  earns?: string;
  open_to_applicants?: boolean;
  closed_to_applicants_on?: string;
  url?: string;
  aliases?: string[];
  notes?: string;
  provenance?: { sources?: OccbSource[] };
  based_on?: {
    card: string;
    exclude?: string[];
    not_followed?: { release: string; reason?: string }[];
  };
  benefits: OccbBenefit[];
  earn_rules: OccbEarnRule[];
  releases: OccbRelease[];
  [k: string]: unknown;
}
export interface OccbIssuer {
  id: string;
  name: string;
}
export interface OccbSpendCategory {
  id: string;
  name: string;
  parent?: string;
  explicit_only?: boolean;
}
export interface OccbPath {
  id: string;
  kind: string;
  rate?: string;
  rate_min?: string;
  rate_max?: string;
  rate_expected?: string;
  requires?: unknown[];
  applies_to_lots?: unknown;
  effective_from?: string;
  effective_to?: string;
  notes?: string;
}
export interface OccbCurrency {
  id: string;
  name: string;
  kind: string;
  cents_per_point?: string;
  url?: string;
  paths?: OccbPath[];
  sources?: OccbSource[];
}
export interface OccbValuation {
  currency: string;
  cpp: string;
  as_of: string;
  method: string;
  source: string;
  scope?: string;
}

// ───────────────────────────── Slugs, files and the legacy map ─────────────────────────────

/**
 * Cards the catalog shipped before it came from OCCB, by OCCB id. Wallet cards and household
 * overrides store these slugs, so they must never change.
 */
export const LEGACY_CARD_SLUGS: Readonly<Record<string, string>> = {
  "us.amex.platinum": "amex_platinum",
  "us.amex.gold": "amex_gold",
  "us.amex.green": "amex_green",
  "us.amex.blue-cash-preferred": "amex_blue_cash_preferred",
  "us.amex.blue-cash-everyday": "amex_blue_cash_everyday",
  "us.amex.blue-business-plus": "amex_blue_business_plus",
  "us.amex.delta-gold": "amex_delta_skymiles_gold",
  "us.amex.delta-platinum": "amex_delta_skymiles_platinum",
  "us.amex.hilton-surpass": "amex_hilton_honors_surpass",
  "us.amex.hilton-aspire": "amex_hilton_honors_aspire",
  "us.apple.card": "apple_card",
  "us.bilt.blue": "bilt_blue",
  "us.bilt.obsidian": "bilt_obsidian",
  "us.bilt.palladium": "bilt_palladium",
  "us.capitalone.venture-x": "capital_one_venture_x",
  "us.capitalone.venture": "capital_one_venture",
  "us.capitalone.savor": "capital_one_savor",
  "us.chase.sapphire-reserve": "chase_sapphire_reserve",
  "us.chase.sapphire-preferred": "chase_sapphire_preferred",
  "us.chase.freedom-unlimited": "chase_freedom_unlimited",
  "us.chase.freedom-flex": "chase_freedom_flex",
  "us.chase.ink-business-preferred": "chase_ink_business_preferred",
  "us.chase.ink-business-cash": "chase_ink_business_cash",
  "us.chase.ink-business-unlimited": "chase_ink_business_unlimited",
  "us.chase.amazon-prime-visa": "chase_prime_visa",
  "us.chase.united-explorer": "chase_united_explorer",
  "us.chase.marriott-bonvoy-boundless": "chase_marriott_bonvoy_boundless",
  "us.chase.world-of-hyatt": "chase_world_of_hyatt",
  "us.citi.strata-elite": "citi_strata_elite",
  "us.citi.strata-premier": "citi_strata_premier",
  "us.citi.double-cash": "citi_double_cash",
  "us.citi.custom-cash": "citi_custom_cash",
  "us.citi.costco-anywhere": "citi_costco_anywhere",
  "us.discover.it-cash-back": "discover_it_cash_back",
  "us.wellsfargo.autograph": "wells_fargo_autograph",
  "us.wellsfargo.active-cash": "wells_fargo_active_cash",
};

/** Cards the old catalog shipped that OCCB doesn't have (yet), with why. */
export const LEGACY_CARDS_WITHOUT_OCCB_MATCH: Readonly<Record<string, string>> = {
  chase_southwest_rapid_rewards_plus:
    "OCCB has only the Southwest Rapid Rewards Priority card, not the Plus card.",
  us_bank_altitude_go:
    "OCCB has the U.S. Bank Altitude Reserve and Cash+ cards, not the Altitude Go card.",
};

/** Programs the old catalog shipped, by OCCB currency id. */
export const LEGACY_PROGRAM_SLUGS: Readonly<Record<string, string>> = {
  "pts:chase_ur": "chase_ur",
  "pts:amex_mr": "amex_mr",
  "pts:capital_one_miles": "capital_one_miles",
  "pts:citi_ty": "citi_thankyou",
  "pts:bilt": "bilt",
  "pts:wells_fargo_rewards": "wells_fargo_rewards",
  "pts:united_mileageplus": "united_mileageplus",
  "pts:delta_skymiles": "delta_skymiles",
  "pts:southwest_rr": "southwest_rr",
  "pts:marriott_bonvoy": "marriott_bonvoy",
  "pts:hilton_honors": "hilton_honors",
  "pts:world_of_hyatt": "world_of_hyatt",
};

/**
 * Every OCCB cashback currency worth exactly 1¢ a point becomes the one `cash_back` program
 * the app has always had (custom cards and overrides refer to it), so issuer cash rewards
 * such as Amex Reward Dollars or Apple Daily Cash aren't separate programs.
 */
export const CASH_BACK_PROGRAM = "cash_back";

const ISSUER_SLUG: Readonly<Record<string, string>> = {
  "us.capitalone": "capital_one",
  "us.usbank": "us_bank",
  "us.wellsfargo": "wells_fargo",
};
const ISSUER_FILE: Readonly<Record<string, string>> = {
  "us.capitalone": "capital-one",
  "us.usbank": "us-bank",
  "us.wellsfargo": "wells-fargo",
  "us.bofa": "bank-of-america",
  "us.cnb": "city-national",
};

const afterRegion = (id: string) => id.slice(id.indexOf(".") + 1);

/** "us.chase.sapphire-preferred" → "chase_sapphire_preferred" (legacy slugs win). */
export function cardSlug(occbId: string, issuerId: string): string {
  const legacy = LEGACY_CARD_SLUGS[occbId];
  if (legacy) return legacy;
  const issuer = ISSUER_SLUG[issuerId] ?? afterRegion(issuerId);
  const rest = occbId.startsWith(`${issuerId}.`) ? occbId.slice(issuerId.length + 1) : occbId;
  return `${issuer}_${rest}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** "pts:citi_ty" → "citi_thankyou" (legacy) or the id without its prefix. */
export function programSlug(currency: Pick<OccbCurrency, "id" | "kind" | "cents_per_point">) {
  if (isCashBack(currency)) return CASH_BACK_PROGRAM;
  return (
    LEGACY_PROGRAM_SLUGS[currency.id] ??
    currency.id
      .replace(/^pts:/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
  );
}

export const isCashBack = (c: Pick<OccbCurrency, "kind" | "cents_per_point">) =>
  c.kind === "cashback" && Number(c.cents_per_point ?? "1") === 1;

/** The catalog file an issuer's cards go in, e.g. "capital-one.json". */
export function issuerFile(issuerId: string): string {
  return `${ISSUER_FILE[issuerId] ?? afterRegion(issuerId).replace(/[^a-z0-9]+/g, "-")}.json`;
}

// ───────────────────────────── Variants (OCCB tools/variants.mjs) ─────────────────────────────

const recordSlug = (id: string) => id.slice(id.indexOf("/") + 1);
const INHERITED_CARD_FIELDS = [
  "issuer_id",
  "network",
  "segment",
  "tier",
  "family",
  "earns",
  "cobrand",
  "fee_posting",
  "card_material",
  "selections",
] as const;

/**
 * Expand a variant card (`based_on`) against its base card, as OCCB's loader does: inherit the
 * base's earn rules and benefits under the variant's ids, and give each following release the
 * base release's changes plus the variant's own.
 */
export function expandVariant(variant: OccbCard, base: OccbCard): OccbCard {
  const spec = variant.based_on;
  if (!spec) return variant;
  const v = variant.id;
  const b = base.id;
  const out: OccbCard = { ...variant };
  const fields = out as Record<string, unknown>;
  for (const k of INHERITED_CARD_FIELDS)
    if (fields[k] === undefined && base[k] !== undefined) fields[k] = base[k];

  const follower = new Map<string, OccbRelease>();
  for (const r of variant.releases) if (r.follows) follower.set(r.follows, r);
  const baseRel = new Map(base.releases.map((r) => [r.id, r]));
  const excluded = new Set(spec.exclude ?? []);
  const ownBenefit = new Set(variant.benefits.map((x) => recordSlug(x.id)));
  const ownRule = new Set(variant.earn_rules.map((x) => recordSlug(x.id)));

  const versionMap = new Map<string, number>();
  function inherit<T extends { id: string; versions: { version: number; release: string }[] }>(
    rec: T,
    kind: "benefit" | "earn_rule",
  ): T | null {
    const kept = rec.versions.filter((x) => follower.has(x.release));
    if (!kept.length) return null;
    const versions = kept.map((x, i) => {
      versionMap.set(`${kind}:${rec.id}#${x.version}`, i + 1);
      const f = follower.get(x.release) as OccbRelease;
      return { ...x, version: i + 1, release: f.id };
    });
    return { ...rec, id: `${v}/${recordSlug(rec.id)}`, based_on: rec.id, versions };
  }
  const inheritedBenefits = base.benefits
    .filter((x) => !excluded.has(x.id) && !ownBenefit.has(recordSlug(x.id)))
    .map((x) => inherit(x, "benefit"))
    .filter((x): x is OccbBenefit => !!x);
  const inheritedRules = base.earn_rules
    .filter((x) => !excluded.has(x.id) && !ownRule.has(recordSlug(x.id)))
    .map((x) => inherit(x, "earn_rule"))
    .filter((x): x is OccbEarnRule => !!x);
  out.benefits = [...inheritedBenefits, ...variant.benefits];
  out.earn_rules = [...inheritedRules, ...variant.earn_rules];

  const remap = (t: string) => {
    const [kind, ...rest] = t.split(":");
    const id = rest.join(":");
    if ((kind === "benefit" || kind === "earn_rule") && id.startsWith(`${b}/`))
      return `${kind}:${v}/${recordSlug(id)}`;
    return t;
  };
  const inheritedIds = new Set([
    ...inheritedBenefits.map((x) => `benefit:${x.based_on}`),
    ...inheritedRules.map((x) => `earn_rule:${x.based_on}`),
  ]);
  out.releases = variant.releases.map((r) => {
    const f = r.follows ? baseRel.get(r.follows) : undefined;
    if (!f) return r;
    const own = new Set((r.changes ?? []).map((ch) => ch.target));
    const fromBase = f.changes.flatMap((ch): OccbChange[] => {
      const isRecord = ch.target.startsWith("benefit:") || ch.target.startsWith("earn_rule:");
      if (isRecord && !inheritedIds.has(ch.target)) return [];
      const target = remap(ch.target);
      if (own.has(target)) return [];
      if (!isRecord || ch.version == null) return [{ ...ch, target }];
      const version = versionMap.get(`${ch.target}#${ch.version}`);
      return version ? [{ ...ch, target, version }] : [];
    });
    return {
      ...f,
      ...r,
      card_id: v,
      changes: [...fromBase, ...(r.changes ?? [])],
      sources: r.sources ?? f.sources,
      id: r.id,
      effective_for_new: r.effective_for_new,
    };
  });
  return out;
}

// ───────────────────────────── Terms for a new applicant ─────────────────────────────

export interface ResolvedRule {
  id: string;
  name?: string;
  categories: string[];
  choice?: OccbChoice;
  v: OccbEarnVersion;
}
export interface ResolvedBenefit extends OccbBenefitVersion {
  id: string;
  kind: string;
  name: string;
}
export interface Terms {
  /** Fixed fees in cents, keyed without the "fee:" prefix ("annual"). */
  fees: Record<string, number>;
  /** Percentage fees as fractions ("0.03"). */
  feeRates: Record<string, string>;
  earn: ResolvedRule[];
  benefits: ResolvedBenefit[];
  /** Releases that apply to someone opening the card on the date. */
  applied: OccbRelease[];
  /** Releases dated after it (announced changes), which are not applied. */
  upcoming: OccbRelease[];
}

/**
 * The terms someone opening the card on `asOf` gets (OCCB spec section 8 with the holder's
 * open date equal to `asOf`): the baseline plus every release effective for new applicants by
 * then, applied in date order; versions that ended before `asOf` are left out.
 */
export function resolveForNewApplicant(card: OccbCard, asOf: string): Terms {
  const releases = [...card.releases].sort((a, b) =>
    a.kind === "baseline"
      ? -1
      : b.kind === "baseline"
        ? 1
        : a.effective_for_new.localeCompare(b.effective_for_new),
  );
  const applied = releases.filter((r) => r.kind === "baseline" || r.effective_for_new <= asOf);
  const upcoming = releases.filter((r) => !applied.includes(r));
  const fees: Record<string, number> = {};
  const feeRates: Record<string, string> = {};
  const earn = new Map<string, ResolvedRule>();
  const benefits = new Map<string, ResolvedBenefit>();
  for (const r of applied) {
    for (const ch of r.changes) {
      const [kind, ...rest] = ch.target.split(":");
      const id = rest.join(":");
      if (kind === "fee") {
        if (ch.rate != null) feeRates[id] = ch.rate;
        else if (ch.to) fees[id] = ch.to.amount;
      } else if (kind === "earn_rule") {
        if (ch.change_type === "retired") earn.delete(id);
        else {
          const rule = card.earn_rules.find((x) => x.id === id);
          const v = rule?.versions.find((x) => x.version === ch.version);
          if (rule && v)
            earn.set(id, {
              id,
              name: rule.name,
              categories: rule.categories,
              choice: rule.choice,
              v,
            });
        }
      } else if (kind === "benefit") {
        if (ch.change_type === "retired") benefits.delete(id);
        else {
          const b = card.benefits.find((x) => x.id === id);
          const v = b?.versions.find((x) => x.version === ch.version);
          if (b && v) benefits.set(id, { ...v, id, kind: b.kind, name: b.name });
        }
      }
    }
  }
  return {
    fees,
    feeRates,
    earn: [...earn.values()].filter((e) => !e.v.effective_to || e.v.effective_to >= asOf),
    benefits: [...benefits.values()].filter((b) => !b.effective_to || b.effective_to >= asOf),
    applied,
    upcoming,
  };
}

// ───────────────────────────── Spend categories ─────────────────────────────

/** OCCB categories that correspond to one of the app's reward categories. */
const DIRECT: Readonly<Record<string, RewardCategory>> = {
  "cat:dining": "dining",
  "cat:dining.delivery": "dining",
  "cat:dining.fast_food": "dining",
  "cat:drugstores": "drugstores",
  "cat:entertainment": "entertainment",
  "cat:entertainment.movie_theaters": "entertainment",
  "cat:fitness": "fitness",
  "cat:gas_ev.ev_charging": "ev_charging",
  "cat:gas_ev.gas": "gas",
  "cat:groceries.online": "online_groceries",
  "cat:groceries.store": "groceries",
  "cat:groceries.wholesale": "wholesale_clubs",
  "cat:home_improvement": "home_improvement",
  "cat:online_shopping": "online_shopping",
  "cat:rent": "rent",
  "cat:streaming": "streaming",
  "cat:superstores": "superstores",
  "cat:telecom": "phone_internet",
  "cat:telecom.wireless": "phone_internet",
  "cat:transit": "transit",
  "cat:travel.transit": "transit",
  "cat:travel.parking_tolls": "transit",
  "cat:travel.car_rental": "car_rental",
  "cat:travel.cruise": "travel",
  "cat:travel.flights": "airfare",
  "cat:travel.flights.direct": "airfare",
  "cat:travel.hotels": "hotels",
  "cat:travel.hotels.direct": "hotels",
  "cat:travel.other": "travel",
  "cat:travel.rideshare": "rideshare",
  "cat:utilities": "utilities",
  "cat:business.advertising": "advertising",
  "cat:business.office_supplies": "office_supply",
  "cat:business.shipping": "shipping",
};

/**
 * OCCB categories narrower than the reward category they map to. A rule that names only
 * these for a reward category applies more widely in the app than the issuer's terms say.
 */
const NARROWER = new Set([
  "cat:dining.delivery",
  "cat:dining.fast_food",
  "cat:entertainment.movie_theaters",
  "cat:telecom.wireless",
  "cat:travel.cruise",
  "cat:travel.parking_tolls",
]);

/**
 * Merchant-specific categories, as case-insensitive substrings of the merchant name or bank
 * description. Strings avoid bare words that match unrelated merchants ("UNITED", "DELTA").
 */
export const MERCHANT_MATCH: Readonly<Record<string, readonly string[]>> = {
  "cat:merchant.ace_hardware": ["ACE HARDWARE"],
  "cat:merchant.amazon": ["AMAZON", "AMZN"],
  "cat:merchant.amazon_fresh": ["AMAZON FRESH", "AMZN FRESH"],
  "cat:merchant.apple": ["APPLE.COM", "APPLE STORE", "APPLE ONLINE STORE", "ITUNES.COM"],
  "cat:merchant.booking_com": ["BOOKING.COM"],
  "cat:merchant.chargepoint": ["CHARGEPOINT"],
  "cat:merchant.costco": ["COSTCO"],
  "cat:merchant.costco_gas": ["COSTCO GAS"],
  "cat:merchant.duane_reade": ["DUANE READE"],
  "cat:merchant.exxon_mobil": ["EXXON", "MOBIL "],
  "cat:merchant.hertz": ["HERTZ"],
  "cat:merchant.nike": ["NIKE"],
  "cat:merchant.target": ["TARGET"],
  "cat:merchant.uber_eats": ["UBER EATS", "UBEREATS"],
  "cat:merchant.walgreens": ["WALGREENS"],
  "cat:merchant.walmart": ["WALMART", "WAL-MART", "WM SUPERCENTER"],
  "cat:merchant.whole_foods": ["WHOLE FOODS", "WHOLEFDS"],
  "cat:travel.flights.direct.aa": ["AMERICAN AIRLINES", "AMERICAN AIR", "AA.COM"],
  "cat:travel.flights.direct.as": ["ALASKA AIR", "ALASKAAIR"],
  "cat:travel.flights.direct.b6": ["JETBLUE"],
  "cat:travel.flights.direct.dl": ["DELTA AIR", "DELTA.COM"],
  "cat:travel.flights.direct.ha": ["HAWAIIAN AIR", "HAWAIIANAIR"],
  "cat:travel.flights.direct.ua": ["UNITED AIRLINES", "UNITED AIR", "UNITED.COM", "UNITED 016"],
  "cat:travel.flights.direct.wn": ["SOUTHWEST AIR", "SOUTHWES 526", "SOUTHWEST.COM"],
  "cat:travel.hotels.direct.hilton": [
    "HILTON",
    "HAMPTON INN",
    "DOUBLETREE",
    "EMBASSY SUITES",
    "HOMEWOOD SUITES",
    "HOME2 SUITES",
    "WALDORF ASTORIA",
    "CONRAD HOTEL",
  ],
  "cat:travel.hotels.direct.hyatt": ["HYATT", "ANDAZ", "ALILA", "THOMPSON HOTEL", "MIRAVAL"],
  "cat:travel.hotels.direct.ihg": [
    "IHG",
    "HOLIDAY INN",
    "CROWNE PLAZA",
    "INTERCONTINENTAL",
    "KIMPTON",
    "STAYBRIDGE",
    "CANDLEWOOD",
    "HOTEL INDIGO",
  ],
  "cat:travel.hotels.direct.marriott": [
    "MARRIOTT",
    "RITZ-CARLTON",
    "RITZ CARLTON",
    "ST. REGIS",
    "ST REGIS",
    "WESTIN",
    "SHERATON",
    "W HOTEL",
    "LE MERIDIEN",
    "RENAISSANCE HOTEL",
    "AUTOGRAPH COLLECTION",
    "TRIBUTE PORTFOLIO",
    "LUXURY COLLECTION",
    "EDITION HOTEL",
    "GAYLORD",
    "DELTA HOTEL",
    "COURTYARD",
    "RESIDENCE INN",
    "FAIRFIELD INN",
    "SPRINGHILL SUITES",
    "TOWNEPLACE",
    "FOUR POINTS",
    "ALOFT",
    "MOXY",
    "AC HOTEL",
  ],
  "cat:travel.hotels.direct.wyndham": [
    "WYNDHAM",
    "LA QUINTA",
    "RAMADA",
    "DAYS INN",
    "SUPER 8",
    "MICROTEL",
    "BAYMONT",
    "WINGATE",
    "HOWARD JOHNSON",
    "TRAVELODGE",
  ],
  "cat:travel.rideshare.lyft": ["LYFT"],
  "cat:travel.rideshare.uber": ["UBER"],
  "cat:travel.vacation_rentals": ["AIRBNB", "VRBO", "HOMEAWAY", "PLUM GUIDE", "VACASA"],
};

/** Issuer travel portals, by the key after `cat:travel.portal.`. */
const PORTAL_ISSUER: Readonly<Record<string, string>> = {
  amex: "us.amex",
  bilt: "us.bilt",
  bofa: "us.bofa",
  capitalone: "us.capitalone",
  chase: "us.chase",
  citi: "us.citi",
  usbank: "us.usbank",
  wellsfargo: "us.wellsfargo",
};

export type Piece =
  | { kind: "category"; category: RewardCategory; from: string }
  | { kind: "portal"; from: string; narrow: boolean }
  | { kind: "merchant"; match: readonly string[]; category?: RewardCategory; from: string }
  | { kind: "unmapped"; from: string; why: string };

export interface Taxonomy {
  byId: ReadonlyMap<string, OccbSpendCategory>;
  children: ReadonlyMap<string, readonly string[]>;
}

export function taxonomy(categories: readonly OccbSpendCategory[]): Taxonomy {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const children = new Map<string, string[]>();
  for (const c of categories)
    if (c.parent) children.set(c.parent, [...(children.get(c.parent) ?? []), c.id]);
  return { byId, children };
}

const isMerchantNode = (id: string) => id in MERCHANT_MATCH || id.startsWith("cat:merchant.");
const label = (tax: Taxonomy, id: string) => tax.byId.get(id)?.name ?? id;

/**
 * How one OCCB spend category maps onto the app's model for a card from `issuerId`. A parent
 * category with no reward category of its own covers its children's (minus merchant-specific
 * and explicit-only ones, which a parent never covers).
 */
export function mapCategory(id: string, tax: Taxonomy, issuerId: string): Piece[] {
  if (id.startsWith("cat:travel.portal")) {
    const key = id.split(".")[2];
    if (!key) return [{ kind: "portal", from: id, narrow: false }];
    if (PORTAL_ISSUER[key] !== issuerId)
      return [{ kind: "unmapped", from: id, why: "a booking site the app can't recognize" }];
    return [{ kind: "portal", from: id, narrow: id.split(".").length > 3 }];
  }
  if (id in MERCHANT_MATCH) {
    const parent = tax.byId.get(id)?.parent;
    const cats = parent
      ? mapCategory(parent, tax, issuerId).filter((p) => p.kind === "category")
      : [];
    return [
      {
        kind: "merchant",
        match: MERCHANT_MATCH[id] as readonly string[],
        category:
          cats.length === 1 ? (cats[0] as { category: RewardCategory }).category : undefined,
        from: id,
      },
    ];
  }
  if (isMerchantNode(id))
    return [{ kind: "unmapped", from: id, why: "a merchant the app has no match for" }];
  const direct = DIRECT[id];
  if (direct) return [{ kind: "category", category: direct, from: id }];
  if (id === "cat:entertainment.capitalone")
    return [{ kind: "unmapped", from: id, why: "purchases through Capital One Entertainment" }];
  const kids = (tax.children.get(id) ?? []).filter(
    (k) => !isMerchantNode(k) && !tax.byId.get(k)?.explicit_only,
  );
  const out: Piece[] = [];
  for (const k of kids) {
    if (k === "cat:travel.portal") {
      out.push({ kind: "category", category: "portal_travel", from: k });
      continue;
    }
    for (const p of mapCategory(k, tax, issuerId)) if (p.kind === "category") out.push(p);
  }
  if (out.length) return out;
  return [{ kind: "unmapped", from: id, why: "no matching reward category" }];
}

/** Every reward category a "cat:all" rule covers: all but rent, which OCCB earns only by name. */
export const ALL_PURCHASES: readonly RewardCategory[] = REWARD_CATEGORY_IDS.filter(
  (c) => c !== "rent",
);

// ───────────────────────────── Small conversions ─────────────────────────────

export const centsToDollars = (cents: number) => Math.round(cents) / 100;

/** OCCB cap periods onto the app's; "statement" (a billing cycle) becomes "month". */
export function capPeriod(p: string | undefined): { period: CapPeriod; approximate: boolean } {
  switch (p) {
    case "month":
    case "quarter":
    case "calendar_year":
    case "cardmember_year":
      return { period: p, approximate: false };
    case "statement":
      return { period: "month", approximate: true };
    default:
      return { period: "calendar_year", approximate: p !== undefined };
  }
}

/** Percent from an OCCB rate fraction: "0.03" → 3. */
export const ratePercent = (rate: string) => Math.round(Number(rate) * 10_000) / 100;

/** A foreign transaction fee stated in prose ("3% foreign transaction fee", "no foreign …"). */
export function fxFeeFromText(text: string | undefined): number | undefined {
  if (!text) return undefined;
  if (/\bno foreign transaction fees?\b/i.test(text)) return 0;
  const before = text.match(/(\d+(?:\.\d+)?)\s*%\s*foreign transaction fee/i);
  if (before) return Number(before[1]);
  const after = text.match(/foreign transaction fees?\s*(?:of|is|:)?\s*(\d+(?:\.\d+)?)\s*%/i);
  if (after) return Number(after[1]);
  return undefined;
}

/** What most US cards charge; used only when OCCB doesn't say. */
export const DEFAULT_FX_FEE_PERCENT = 3;

export function fxFee(
  card: Pick<OccbCard, "notes" | "summary">,
  terms: Pick<Terms, "benefits" | "feeRates">,
): { percent: number; how: "waiver" | "fee" | "notes" | "default" } {
  const waived = terms.benefits.some(
    (b) =>
      b.waives === "foreign_transaction_fee" ||
      (b.grants ?? []).some((g) => g.entitlement === "fee_waiver:foreign_transaction"),
  );
  if (waived) return { percent: 0, how: "waiver" };
  const rate = terms.feeRates.foreign_transaction;
  if (rate != null) return { percent: ratePercent(rate), how: "fee" };
  const text = fxFeeFromText(card.notes) ?? fxFeeFromText(card.summary);
  if (text != null) return { percent: text, how: "notes" };
  return { percent: DEFAULT_FX_FEE_PERCENT, how: "default" };
}

/** Shorten to `max` characters, at a sentence end when there is one. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const end = cut.lastIndexOf(". ");
  return end > max / 2 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

const fmt = (n: number) => `${Number(n.toFixed(4))}`;
const quarterOf = (date: string) =>
  `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;

// ───────────────────────────── Earn rules ─────────────────────────────

/** Conditions the app treats as met (OCCB's reference engine does the same). */
const ASSUMED_CONDITIONS = new Set(["region", "enrollment_required"]);

function conditionNote(c: OccbCondition): string | undefined {
  if (c.type === "region") return "U.S. purchases only.";
  if (c.type === "enrollment_required") return "Requires enrollment or activation.";
  if (c.type === "payment_method")
    return `Requires paying with ${String(c.method).replace(/_/g, " ")}.`;
  return undefined;
}

const isSelection = (c: OccbCondition): boolean =>
  c.type === "selection_is" ||
  (c.type === "any_of" && ((c.conditions as OccbCondition[]) ?? []).every(isSelection));

const selectionNames = (cs: readonly OccbCondition[]): string[] =>
  cs.flatMap((c) =>
    c.type === "selection_is"
      ? [String(c.name).replace(/_/g, " ")]
      : selectionNames((c.conditions as OccbCondition[]) ?? []),
  );

export interface ConvertedEarn {
  base: number;
  earn: EarnRule[];
  rotating?: Record<string, RewardCategory[]>;
  /** Sentences for the card's notes: what was dropped or approximated. */
  notes: string[];
}

interface Draft {
  rule: EarnRule;
  occb: ResolvedRule;
  stacks: boolean;
  selection?: OccbCondition[];
}

/** The rule's own name, else the names of its categories. */
function ruleName(r: ResolvedRule, tax: Taxonomy): string {
  if (r.name) return r.name;
  const names = r.categories.map((c) => (c === "cat:all" ? "All purchases" : label(tax, c)));
  return clip(names.join(", "), 80);
}

/**
 * Convert a card's resolved earn rules. `currencyName` names other currencies for notes.
 */
export function convertEarn(
  card: Pick<OccbCard, "issuer_id" | "earns">,
  rules: readonly ResolvedRule[],
  tax: Taxonomy,
  currencyName: (id: string) => string = (id) => id,
): ConvertedEarn {
  const notes: string[] = [];
  const drafts: Draft[] = [];
  const rotating: Record<string, RewardCategory[]> = {};
  const baseCandidates: number[] = [];
  const narrowPortal: string[] = [];
  const narrowOther: string[] = [];
  const unmapped = new Map<string, string>();
  const capNotes: string[] = [];

  for (const r of rules) {
    const v = r.v;
    const name = ruleName(r, tax);
    if (v.boost != null) {
      notes.push(
        `Not modeled: ${name} (${fmt(Number(v.boost) * 100)}% more on all earn, which depends on a banking relationship).`,
      );
      continue;
    }
    if (v.multiplier == null) continue;
    const mult = Number(v.multiplier);
    if (v.currency && v.currency !== card.earns) {
      notes.push(
        `Not modeled: ${currencyName(v.currency)} earned alongside the points (${fmt(mult)} per dollar${r.name ? `, ${r.name}` : ""}).`,
      );
      continue;
    }
    if (v.channel) {
      notes.push(
        `Not modeled: ${name} (${fmt(mult)}x), which applies only to purchases made through ${v.channel.replace(/_/g, " ")}.`,
      );
      continue;
    }
    const conditions = v.conditions ?? [];
    const blocking = conditions.filter(
      (c) => !ASSUMED_CONDITIONS.has(c.type) && c.type !== "payment_method" && !isSelection(c),
    );
    if (blocking.length) {
      const why = blocking
        .map((c) =>
          c.type === "min_transaction"
            ? `purchases of $${centsToDollars(Number(c.amount)).toLocaleString("en-US")} or more`
            : c.type === "spend_gte"
              ? `spending after the first $${centsToDollars(Number(c.amount)).toLocaleString("en-US")} a year`
              : (c.note ?? c.type.replace(/_/g, " ")),
        )
        .join("; ");
      notes.push(`Not modeled: ${name} (${fmt(mult)}x), which applies only to ${why}.`);
      continue;
    }
    const isAll = r.categories.includes("cat:all");
    const payment = conditions.find((c) => c.type === "payment_method");
    if (payment && isAll) {
      notes.push(
        `Not modeled: ${fmt(mult)}x on purchases paid with ${String(payment.method).replace(/_/g, " ")}, since the app can't tell how a purchase was paid.`,
      );
      continue;
    }
    const selection = conditions.filter(isSelection);
    const ruleNotes = [
      v.notes,
      ...conditions.map(conditionNote).filter((x): x is string => !!x),
    ].filter((x): x is string => !!x);
    const common: Partial<EarnRule> = {
      multiplier: mult,
      ...(v.effective_from ? { validFrom: v.effective_from } : {}),
      ...(v.effective_to ? { validTo: v.effective_to } : {}),
      ...(ruleNotes.length ? { note: clip(ruleNotes.join(" "), 300) } : {}),
    };
    if (v.cap) {
      const cp = capPeriod(v.cap_period);
      common.cap = { amount: centsToDollars(v.cap.amount), period: cp.period };
      if (cp.approximate)
        capNotes.push(
          `The cap on ${name} resets each ${v.cap_period ?? "period"}; it is counted per ${cp.period} here.`,
        );
    }

    // Base rate: an unconditional, uncapped rule on everything.
    if (
      isAll &&
      !r.choice &&
      !v.cap &&
      !v.stacks &&
      !selection.length &&
      !v.effective_from &&
      !v.effective_to
    ) {
      baseCandidates.push(mult);
      continue;
    }

    const push = (rule: Partial<EarnRule>) =>
      drafts.push({
        rule: { categories: [], channel: "any", ...common, ...rule } as EarnRule,
        occb: r,
        stacks: !!v.stacks,
        selection: selection.length ? selection : undefined,
      });

    if (r.choice?.mode === "rotating") {
      const merchantsDropped = new Set<string>();
      for (const s of v.schedule ?? []) {
        const cats = new Set<RewardCategory>();
        for (const id of s.categories)
          for (const p of mapCategory(id, tax, card.issuer_id)) {
            if (p.kind === "category") cats.add(p.category);
            else if (p.kind === "portal") cats.add("portal_travel");
            else merchantsDropped.add(label(tax, p.from));
          }
        const q = quarterOf(s.from);
        if (cats.size) rotating[q] = [...new Set([...(rotating[q] ?? []), ...cats])];
      }
      if (merchantsDropped.size)
        notes.push(
          `Rotating categories that are single merchants are not modeled: ${[...merchantsDropped].join(", ")}.`,
        );
      if (Object.keys(rotating).length) push({ rotating: true });
      else notes.push(`Not modeled: ${name}, whose quarterly categories have no match in the app.`);
      continue;
    }

    if (r.choice) {
      const options =
        r.choice.groups?.map((g) => ({ label: g.name ?? g.id, cats: g.categories })) ??
        r.categories.map((c) => ({ label: label(tax, c), cats: [c] }));
      const eligible = new Set<RewardCategory>();
      const lost: string[] = [];
      for (const o of options) {
        const pieces = o.cats.flatMap((c) => mapCategory(c, tax, card.issuer_id));
        const cats = pieces.filter((p) => p.kind === "category").map((p) => p.category);
        const narrow = o.cats.every((c) => NARROWER.has(c));
        if (!cats.length || narrow) lost.push(o.label.replace(/_/g, " "));
        else for (const c of cats) eligible.add(c);
      }
      if (!eligible.size) {
        notes.push(`Not modeled: ${name}, whose choices have no match in the app.`);
        continue;
      }
      const mode = r.choice.mode === "top_spend" ? "top_spend" : "user_choice";
      if (lost.length)
        notes.push(`${name}: choices with no matching category are left out (${lost.join(", ")}).`);
      if ((r.choice.pick ?? 1) > 1)
        notes.push(
          `${name}: the issuer applies it to ${r.choice.pick} categories at once; ${mode === "top_spend" ? "the app counts only the top one" : "each chosen category counts"}.`,
        );
      push({ pick: { mode, eligible: [...eligible] } });
      continue;
    }

    // Plain rule: split into reward categories, the issuer's own booking site and merchants.
    const pieces = isAll
      ? ALL_PURCHASES.map((c): Piece => ({ kind: "category", category: c, from: "cat:all" }))
      : r.categories.flatMap((c) => mapCategory(c, tax, card.issuer_id));
    const cats = pieces.filter((p) => p.kind === "category");
    const catSet = [...new Set(cats.map((p) => p.category))];
    const portal = pieces.filter((p) => p.kind === "portal");
    const merchants = pieces.filter((p) => p.kind === "merchant");
    const lostHere = pieces.filter((p) => p.kind === "unmapped");
    for (const c of catSet) {
      const from = cats.filter((p) => p.category === c).map((p) => p.from);
      if (from.every((f) => NARROWER.has(f)))
        narrowOther.push(
          `the ${fmt(mult)}x rate on ${from.map((f) => label(tax, f).toLowerCase()).join(" and ")} counts for all ${REWARD_CATEGORIES[c].label.toLowerCase()}`,
        );
    }
    if (portal.some((p) => p.narrow))
      narrowPortal.push(`${portal.map((p) => label(tax, p.from)).join(" and ")} (${fmt(mult)}x)`);
    const parts: Partial<EarnRule>[] = [];
    if (catSet.length) parts.push({ categories: catSet });
    if (portal.length) parts.push({ categories: ["portal_travel"], channel: "portal" });
    // Merchant pieces a category piece already covers add nothing.
    const extra = merchants.filter((m) => !m.category || !catSet.includes(m.category));
    if (extra.length) {
      const match = [...new Set(extra.flatMap((m) => m.match))];
      const mcats = [...new Set(extra.map((m) => m.category))];
      parts.push({
        categories: mcats.length === 1 && mcats[0] ? [mcats[0]] : [],
        merchants: match,
      });
    }
    if (!parts.length) {
      const why = [...new Set(lostHere.map((p) => p.why))].join("; ") || "no matching category";
      notes.push(`Not modeled: ${name} (${fmt(mult)}x): ${why}.`);
      continue;
    }
    for (const p of lostHere) unmapped.set(label(tax, p.from), p.why);
    if (parts.length > 1 && v.cap)
      capNotes.push(`The shared cap on ${name} is counted separately for each part of it here.`);
    for (const part of parts) push(part);
  }

  // Rules that depend on an option the cardholder picks. A choice between categories (Bilt
  // Obsidian's dining or groceries) becomes a user_choice rule per category; a choice that
  // changes the rate on the same purchases (Bilt's housing tiers) keeps the highest rate.
  // A "selection" that is really a time window (Citi Nights) can't be represented.
  const keep = new Set<Draft>(drafts.filter((d) => !d.selection));
  const byName = new Map<string, Draft[]>();
  for (const d of drafts.filter((x) => x.selection)) {
    const sel = d.selection ?? [];
    if (sel.some((c) => c.type === "selection_is" && typeof c.value === "boolean")) {
      notes.push(
        `Not modeled: ${ruleName(d.occb, tax)} (${fmt(d.rule.multiplier)}x), which depends on the ${selectionNames(sel).join(" and ")}, which the app can't see.`,
      );
      continue;
    }
    const first = selectionNames(sel)[0] ?? "";
    byName.set(first, [...(byName.get(first) ?? []), d]);
  }
  const catLabel = (c: RewardCategory) => REWARD_CATEGORIES[c].label.toLowerCase();
  const sig = (d: Draft) =>
    JSON.stringify([[...d.rule.categories].sort(), d.rule.merchants, d.rule.channel, d.rule.pick]);
  for (const [selName, group] of byName) {
    const disjoint = group.every((d, i) =>
      group.every(
        (o, j) => i === j || !o.rule.categories.some((c) => d.rule.categories.includes(c)),
      ),
    );
    const categoryChoice =
      group.length > 1 &&
      disjoint &&
      group.every(
        (d) =>
          d.rule.categories.length &&
          !d.rule.merchants &&
          d.rule.channel === "any" &&
          !d.rule.pick &&
          !d.rule.rotating,
      );
    if (categoryChoice) {
      for (const d of group) {
        d.rule.pick = { mode: "user_choice", eligible: d.rule.categories };
        d.rule.categories = [];
        keep.add(d);
      }
      notes.push(
        `${group.map((d) => `${(d.rule.pick?.eligible ?? []).map(catLabel).join(", ")} (${fmt(d.rule.multiplier)}x)`).join(" or ")}: earns only on the one the cardholder picks (${selName}); record it on the wallet card.`,
      );
      continue;
    }
    const bySig = new Map<string, Draft[]>();
    for (const d of group) bySig.set(sig(d), [...(bySig.get(sig(d)) ?? []), d]);
    for (const same of bySig.values()) {
      const best = same.reduce((a, b) => (b.rule.multiplier > a.rule.multiplier ? b : a));
      keep.add(best);
      const rates = [...new Set(same.map((d) => d.rule.multiplier))].sort((a, b) => a - b);
      const names = [...new Set(same.flatMap((d) => selectionNames(d.selection ?? [])))];
      const what = best.rule.categories.map(catLabel).join(", ") || ruleName(best.occb, tax);
      notes.push(
        rates.length > 1
          ? `The ${what} rate is ${rates.map(fmt).join("x, ")}x depending on the cardholder's ${names.join(" and ")}; the highest is shown.`
          : `The ${what} rate assumes the cardholder's ${names.join(" and ")} option.`,
      );
    }
  }
  let kept = drafts.filter((d) => keep.has(d));
  const base = baseCandidates.length ? Math.max(...baseCandidates) : 0;
  if (!baseCandidates.length)
    notes.push("OCCB lists no rate for everyday purchases, so the base rate is 0.");

  // Stacking rules add to whatever else applies. They fold into one rate only when nothing
  // but the base rate covers the same purchases.
  for (const d of kept.filter((x) => x.stacks)) {
    const others = kept.filter((x) => x !== d && !x.stacks);
    const overlaps = others.some(
      (o) =>
        o.rule.channel === d.rule.channel &&
        (o.rule.pick ||
          o.rule.rotating ||
          o.rule.categories.some((c) => d.rule.categories.includes(c)) ||
          (o.rule.merchants?.length && d.rule.merchants?.length)),
    );
    if (overlaps || d.rule.pick || d.rule.rotating) {
      notes.push(
        `Not modeled: ${ruleName(d.occb, tax)} (${fmt(d.rule.multiplier)}x more on top of the card's other rates).`,
      );
      kept = kept.filter((x) => x !== d);
    } else {
      d.rule.multiplier = Number((d.rule.multiplier + base).toFixed(4));
      d.rule.note = clip(
        `${d.rule.note ? `${d.rule.note} ` : ""}OCCB adds ${fmt(d.rule.multiplier - base)}x to the ${fmt(base)}x base rate.`,
        300,
      );
    }
  }

  // Rules sharing one cap (OCCB cap_group) at the same rate become one rule, which shares the
  // cap exactly; at different rates each keeps the whole cap, which overstates.
  const groups = new Map<string, Draft[]>();
  for (const d of kept) {
    const g = d.occb.v.cap_group;
    if (g && d.rule.cap) groups.set(g, [...(groups.get(g) ?? []), d]);
  }
  for (const ds of groups.values()) {
    if (ds.length < 2) continue;
    const first = ds[0] as Draft;
    const mergeable = ds.every(
      (d) =>
        d.rule.multiplier === first.rule.multiplier &&
        d.rule.channel === first.rule.channel &&
        !d.rule.merchants &&
        !d.rule.pick &&
        !d.rule.rotating &&
        d.rule.cap?.amount === first.rule.cap?.amount &&
        d.rule.cap?.period === first.rule.cap?.period,
    );
    if (mergeable) {
      first.rule.categories = [...new Set(ds.flatMap((d) => d.rule.categories))];
      const merged = [...new Set(ds.map((d) => d.rule.note).filter((x): x is string => !!x))];
      if (merged.length) first.rule.note = clip(merged.join(" "), 300);
      kept = kept.filter((d) => d === first || !ds.includes(d));
    } else {
      capNotes.push(
        `${ds.map((d) => ruleName(d.occb, tax)).join(" and ")} share one cap; each is capped separately here.`,
      );
    }
  }

  for (const d of kept) if (d.rule.cap) d.rule.afterCap = base;

  if (narrowPortal.length)
    notes.push(
      `The app can't tell booking types apart on the issuer's travel site, so the best of these rates applies to every booking there: ${[...new Set(narrowPortal)].join("; ")}.`,
    );
  if (narrowOther.length) notes.push(`Approximated: ${[...new Set(narrowOther)].join("; ")}.`);
  if (unmapped.size)
    notes.push(`Not modeled, for lack of a matching category: ${[...unmapped.keys()].join(", ")}.`);
  notes.push(...new Set(capNotes));

  // Same categories, same rate, no other terms: keep one.
  const seen = new Set<string>();
  const earn = kept
    .map((d) => d.rule)
    .filter((r) => {
      const key = JSON.stringify({ ...r, note: undefined });
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    // Rates at or below the base rate never win, except capped or dated ones (kept for clarity).
    .filter((r) => r.multiplier > base || r.rotating || r.pick);
  return {
    base,
    earn,
    ...(earn.some((r) => r.rotating) ? { rotating } : {}),
    notes: [...new Set(notes)].map((n) => n.charAt(0).toUpperCase() + n.slice(1)),
  };
}

// ───────────────────────────── Cards ─────────────────────────────

const NETWORKS = new Set(["visa", "mastercard", "amex", "discover"]);

/** Sources for a card: issuer pages first, then reviews; https only, at most ten. */
export function cardSources(card: OccbCard, terms: Terms): OccbSource[] {
  const all = [
    ...(card.url ? [{ url: card.url, publisher: "issuer" }] : []),
    ...(card.provenance?.sources ?? []),
    ...terms.applied.flatMap((r) => r.sources ?? []),
    ...terms.earn.flatMap((r) => r.v.sources ?? []),
  ].filter((s) => s.url?.startsWith("https://"));
  const seen = new Set<string>();
  const unique = all.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
  const rank = (s: OccbSource) => (s.publisher === "issuer" ? 0 : 1);
  return [...unique].sort((a, b) => rank(a) - rank(b)).slice(0, 10);
}

export interface ConvertedCard {
  file: string;
  card: Card;
  /** Report lines: everything dropped or approximated, plus how the FX fee was set. */
  notes: string[];
  fxHow: ReturnType<typeof fxFee>["how"];
}

export function convertCard(
  card: OccbCard,
  asOf: string,
  ctx: {
    tax: Taxonomy;
    issuerName: (id: string) => string;
    currency: (id: string) => OccbCurrency | undefined;
  },
): ConvertedCard {
  const terms = resolveForNewApplicant(card, asOf);
  const earns = card.earns ?? "";
  const cur = ctx.currency(earns);
  const converted = convertEarn(card, terms.earn, ctx.tax, (id) => ctx.currency(id)?.name ?? id);
  const fx = fxFee(card, terms);
  const sources = cardSources(card, terms);
  const verifiedAt =
    sources
      .map((s) => s.retrieved_at)
      .filter((d): d is string => !!d)
      .sort()
      .at(-1) ?? asOf;
  const notes: string[] = [];
  if (card.open_to_applicants === false)
    notes.push(
      `No longer open to new applicants${card.closed_to_applicants_on ? ` (since ${card.closed_to_applicants_on})` : ""}.`,
    );
  if (!NETWORKS.has(card.network ?? ""))
    notes.push("The network depends on the card issued (OCCB lists it as other).");
  notes.push(...converted.notes);
  if (fx.how === "default")
    notes.push(
      `OCCB doesn't state a foreign transaction fee; ${DEFAULT_FX_FEE_PERCENT}% is assumed.`,
    );
  if (terms.fees.annual === undefined) notes.push("OCCB lists no annual fee; $0 is assumed.");
  const upcoming = terms.upcoming.map((r) => r.effective_for_new);
  if (upcoming.length)
    notes.push(`Changes announced for ${[...new Set(upcoming)].join(", ")} are not reflected yet.`);
  let text = notes.join(" ");
  if (card.notes && text.length + card.notes.length < 990) text = `${text} ${card.notes}`.trim();
  const cardOut: Card = {
    slug: cardSlug(card.id, card.issuer_id),
    issuer: ctx.issuerName(card.issuer_id),
    name: card.name,
    network: (NETWORKS.has(card.network ?? "") ? card.network : "other") as Card["network"],
    annualFee: centsToDollars(terms.fees.annual ?? 0),
    program: cur ? programSlug(cur) : earns,
    fxFeePercent: fx.percent,
    base: converted.base,
    earn: converted.earn,
    ...(converted.rotating ? { rotating: converted.rotating } : {}),
    business: card.segment === "business",
    aliases: [...new Set((card.aliases ?? []).filter((a) => a.length >= 2 && a !== card.name))]
      .map((a) => a.slice(0, 100))
      .slice(0, 10),
    sources: sources.map((s) => ({
      url: s.url,
      ...(s.title ? { title: s.title.slice(0, 200) } : {}),
    })),
    verifiedAt,
    ...(text ? { notes: clip(text, 1000) } : {}),
  };
  return { file: issuerFile(card.issuer_id), card: cardOut, notes, fxHow: fx.how };
}

// ───────────────────────────── Programs ─────────────────────────────

const FLOOR_KINDS = new Set(["cash", "statement_credit", "portal"]);
const num = (s: string | undefined) => (s == null ? undefined : Number(s));

/**
 * The best fixed rate every holder can redeem at: cash, statement credit or the issuer's
 * travel site, with no other card required and no lot or date limits. A range counts at its
 * minimum.
 */
export function floorPath(currency: OccbCurrency, asOf: string): { cpp: number; path?: OccbPath } {
  const candidates = (currency.paths ?? [])
    .filter(
      (p) =>
        FLOOR_KINDS.has(p.kind) &&
        !p.requires?.length &&
        !p.applies_to_lots &&
        (!p.effective_from || p.effective_from <= asOf) &&
        (!p.effective_to || p.effective_to >= asOf),
    )
    .map((p) => ({ path: p, cpp: num(p.rate) ?? num(p.rate_min) }))
    .filter((x): x is { path: OccbPath; cpp: number } => x.cpp != null && Number.isFinite(x.cpp));
  if (!candidates.length) return { cpp: 0 };
  return candidates.reduce((a, b) => (b.cpp > a.cpp ? b : a));
}

/** The newest published valuation for a currency; on a tie a benchmark beats a floor. */
export function newestValuation(
  valuations: readonly OccbValuation[],
  currencyId: string,
): OccbValuation | undefined {
  const mine = valuations
    .map((v, i) => ({ v, i }))
    .filter((x) => x.v.currency === currencyId && Number.isFinite(Number(x.v.cpp)));
  mine.sort(
    (a, b) =>
      b.v.as_of.localeCompare(a.v.as_of) ||
      Number(b.v.method === "benchmark") - Number(a.v.method === "benchmark") ||
      b.i - a.i,
  );
  return mine[0]?.v;
}

const KNOWN_PUBLISHERS: Readonly<Record<string, string>> = {
  "thepointsguy.com": "The Points Guy",
  "onemileatatime.com": "One Mile at a Time",
};

function publisher(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return KNOWN_PUBLISHERS[host] ?? host;
  } catch {
    return url.slice(0, 60);
  }
}

const isUrl = (s: string | undefined): s is string => !!s && /^https:\/\//.test(s);

function unitOf(c: OccbCurrency): Program["unit"] {
  if (c.kind === "cashback") return "cash";
  if (/\bmiles?\b|mileage/i.test(c.name)) return "miles";
  if (c.kind === "airline" && !/points|rewards/i.test(c.name)) return "miles";
  return "points";
}

function kindOf(c: OccbCurrency): Program["kind"] {
  switch (c.kind) {
    case "transferable":
    case "airline":
    case "hotel":
      return c.kind;
    default:
      return "cash_back";
  }
}

export function convertProgram(
  currency: OccbCurrency,
  valuations: readonly OccbValuation[],
  asOf: string,
): { program: Program; notes: string[] } {
  const notes: string[] = [];
  const floor = floorPath(currency, asOf);
  let floorCpp = floor.cpp;
  let floorNote = floor.path
    ? clip(
        `${floor.path.notes ? `${floor.path.notes.replace(/\.$/, "")}: ` : ""}${fmt(floor.cpp)}¢ a point (${floor.path.kind.replace(/_/g, " ")}), the best fixed rate any holder can get in OCCB.`,
        300,
      )
    : "OCCB lists no fixed-value redemption open to every holder, so the floor is 0.";
  if (!floor.path && currency.cents_per_point) {
    floorCpp = Number(currency.cents_per_point);
    floorNote = `Each point is worth ${fmt(floorCpp)}¢ (OCCB).`;
  }
  const val = newestValuation(valuations, currency.id);
  const fallbackUrl =
    currency.url && isUrl(currency.url)
      ? currency.url
      : currency.sources?.find((s) => isUrl(s.url))?.url;
  let typicalCpp = floorCpp;
  let valuation: Program["valuation"];
  if (val && isUrl(val.source)) {
    typicalCpp = Math.max(Number(val.cpp), floorCpp);
    if (Number(val.cpp) < floorCpp)
      notes.push(
        `${currency.id}: published ${val.cpp}¢ is below the ${fmt(floorCpp)}¢ floor; the floor is used.`,
      );
    valuation = {
      source: clip(`${publisher(val.source)} (OCCB value set)`, 100),
      url: val.source,
      asOf: val.as_of,
    };
  } else {
    notes.push(`${currency.id}: no published valuation in OCCB; typical value set to the floor.`);
    valuation = {
      source: "No published valuation in OCCB; the floor is used",
      url: fallbackUrl ?? "https://github.com/nathanielnoyd/open-credit-card-benefits",
      asOf,
    };
  }
  const verifiedAt =
    [...(currency.sources ?? []).map((s) => s.retrieved_at), val?.as_of]
      .filter((d): d is string => !!d)
      .sort()
      .at(-1) ?? asOf;
  return {
    program: {
      slug: programSlug(currency),
      name: currency.name,
      kind: kindOf(currency),
      unit: unitOf(currency),
      floorCpp,
      floorNote,
      typicalCpp,
      valuation,
      verifiedAt,
    },
    notes,
  };
}

/** The single cash back program, from every 1¢ cashback currency the cards earn. */
export function cashBackProgram(
  members: readonly OccbCurrency[],
  valuations: readonly OccbValuation[],
  asOf: string,
): Program {
  const converted = members.map((m) => convertProgram(m, valuations, asOf).program);
  const newest = [...converted].sort((a, b) => b.valuation.asOf.localeCompare(a.valuation.asOf))[0];
  return {
    slug: CASH_BACK_PROGRAM,
    name: "Cash back",
    kind: "cash_back",
    unit: "cash",
    floorCpp: Math.min(...converted.map((p) => p.floorCpp), 1),
    floorNote: clip(
      `1 point = 1 cent, as a statement credit or deposit. Covers: ${members.map((m) => m.name).join(", ")}.`,
      300,
    ),
    typicalCpp: Math.min(...converted.map((p) => p.typicalCpp), 1),
    valuation: {
      source: "Fixed by definition: 1 point = 1 cent",
      url: newest?.valuation.url ?? "https://github.com/nathanielnoyd/open-credit-card-benefits",
      asOf: newest?.valuation.asOf ?? asOf,
    },
    verifiedAt:
      converted
        .map((p) => p.verifiedAt)
        .sort()
        .at(-1) ?? asOf,
  };
}
