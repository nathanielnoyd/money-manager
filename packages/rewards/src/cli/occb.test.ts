import { describe, expect, it } from "vitest";
import { Card, Program } from "../schema";
import {
  CASH_BACK_PROGRAM,
  capPeriod,
  cardSlug,
  clip,
  convertCard,
  convertEarn,
  convertProgram,
  expandVariant,
  floorPath,
  fxFee,
  fxFeeFromText,
  issuerFile,
  mapCategory,
  newestValuation,
  type OccbCard,
  type OccbCurrency,
  type OccbEarnVersion,
  type OccbSpendCategory,
  programSlug,
  type ResolvedRule,
  resolveForNewApplicant,
  taxonomy,
} from "./occb";

const TAX = taxonomy([
  { id: "cat:all", name: "All purchases" },
  { id: "cat:dining", name: "Dining", parent: "cat:all" },
  { id: "cat:dining.fast_food", name: "Fast food restaurants", parent: "cat:dining" },
  { id: "cat:gas_ev", name: "Gas and EV charging", parent: "cat:all" },
  { id: "cat:gas_ev.gas", name: "Gas stations", parent: "cat:gas_ev" },
  { id: "cat:gas_ev.ev_charging", name: "EV charging", parent: "cat:gas_ev" },
  { id: "cat:groceries", name: "Groceries", parent: "cat:all" },
  { id: "cat:groceries.store", name: "Supermarkets", parent: "cat:groceries" },
  { id: "cat:rent", name: "Rent", parent: "cat:all", explicit_only: true },
  { id: "cat:mortgage", name: "Mortgage payments", parent: "cat:all", explicit_only: true },
  { id: "cat:apparel", name: "Clothing stores", parent: "cat:all" },
  { id: "cat:travel", name: "Travel", parent: "cat:all" },
  { id: "cat:travel.flights", name: "Flights", parent: "cat:travel" },
  {
    id: "cat:travel.flights.direct",
    name: "Flights booked with the airline",
    parent: "cat:travel.flights",
  },
  {
    id: "cat:travel.flights.direct.dl",
    name: "Delta purchases",
    parent: "cat:travel.flights.direct",
  },
  { id: "cat:travel.hotels", name: "Hotels", parent: "cat:travel" },
  { id: "cat:travel.rideshare", name: "Rideshare", parent: "cat:travel" },
  { id: "cat:travel.rideshare.lyft", name: "Lyft", parent: "cat:travel.rideshare" },
  { id: "cat:travel.portal", name: "Issuer travel portals", parent: "cat:travel" },
  { id: "cat:travel.portal.chase", name: "Chase Travel", parent: "cat:travel.portal" },
  {
    id: "cat:travel.portal.chase.flights",
    name: "Chase Travel flights",
    parent: "cat:travel.portal.chase",
  },
  { id: "cat:travel.portal.amex", name: "Amex Travel", parent: "cat:travel.portal" },
  { id: "cat:merchant.amazon", name: "Amazon.com", parent: "cat:all" },
  { id: "cat:merchant.red_cross", name: "Red Cross", parent: "cat:all" },
] satisfies OccbSpendCategory[]);

const CHASE = { issuer_id: "us.chase", earns: "pts:chase_ur" };
const rule = (
  id: string,
  categories: string[],
  v: Partial<OccbEarnVersion>,
  extra: Partial<ResolvedRule> = {},
): ResolvedRule => ({
  id: `us.chase.test/${id}`,
  categories,
  v: { version: 1, release: "r", ...v },
  ...extra,
});
const BASE = rule("base", ["cat:all"], { multiplier: "1" });

describe("slugs and files", () => {
  it("keeps legacy slugs and derives the rest from OCCB ids", () => {
    expect(cardSlug("us.chase.amazon-prime-visa", "us.chase")).toBe("chase_prime_visa");
    expect(cardSlug("us.amex.delta-gold", "us.amex")).toBe("amex_delta_skymiles_gold");
    expect(cardSlug("us.capitalone.quicksilver", "us.capitalone")).toBe("capital_one_quicksilver");
    expect(cardSlug("us.bofa.atmos-ascent", "us.bofa")).toBe("bofa_atmos_ascent");
  });

  it("maps programs, folding 1¢ cash back currencies into cash_back", () => {
    expect(programSlug({ id: "pts:citi_ty", kind: "transferable" })).toBe("citi_thankyou");
    expect(programSlug({ id: "pts:ihg_one", kind: "hotel" })).toBe("ihg_one");
    expect(
      programSlug({ id: "pts:apple_daily_cash", kind: "cashback", cents_per_point: "1.0" }),
    ).toBe(CASH_BACK_PROGRAM);
    expect(programSlug({ id: "pts:odd", kind: "cashback", cents_per_point: "0.5" })).toBe("odd");
  });

  it("names issuer files", () => {
    expect(issuerFile("us.amex")).toBe("amex.json");
    expect(issuerFile("us.capitalone")).toBe("capital-one.json");
    expect(issuerFile("us.bofa")).toBe("bank-of-america.json");
  });
});

describe("small conversions", () => {
  it("maps cap periods, approximating a statement as a month", () => {
    expect(capPeriod("quarter")).toEqual({ period: "quarter", approximate: false });
    expect(capPeriod("statement")).toEqual({ period: "month", approximate: true });
  });

  it("reads a foreign transaction fee from prose", () => {
    expect(fxFeeFromText("Charges a 3% foreign transaction fee.")).toBe(3);
    expect(fxFeeFromText("Foreign transaction fee of 2.7%.")).toBe(2.7);
    expect(fxFeeFromText("with no foreign transaction fees.")).toBe(0);
    expect(fxFeeFromText("Nothing about fees.")).toBeUndefined();
  });

  it("prefers a waiver, then a release fee, then notes, then the default", () => {
    const waiver = {
      id: "b",
      kind: "fee_waiver",
      name: "No FX",
      version: 1,
      release: "r",
      grants: [{ entitlement: "fee_waiver:foreign_transaction" }],
    };
    expect(
      fxFee({ notes: "3% foreign transaction fee" }, { benefits: [waiver], feeRates: {} }),
    ).toEqual({ percent: 0, how: "waiver" });
    expect(fxFee({}, { benefits: [], feeRates: { foreign_transaction: "0.027" } })).toEqual({
      percent: 2.7,
      how: "fee",
    });
    expect(fxFee({ notes: "3% foreign transaction fee." }, { benefits: [], feeRates: {} })).toEqual(
      {
        percent: 3,
        how: "notes",
      },
    );
    expect(fxFee({}, { benefits: [], feeRates: {} })).toEqual({ percent: 3, how: "default" });
  });

  it("clips at a sentence end", () => {
    expect(clip("One two three. Four five six seven.", 20)).toBe("One two three.");
    expect(clip("short", 20)).toBe("short");
  });
});

describe("mapCategory", () => {
  it("maps a direct category and expands a parent to its children", () => {
    expect(mapCategory("cat:dining", TAX, "us.chase")).toEqual([
      { kind: "category", category: "dining", from: "cat:dining" },
    ]);
    const gas = mapCategory("cat:gas_ev", TAX, "us.chase").map(
      (p) => p.kind === "category" && p.category,
    );
    expect(gas.sort()).toEqual(["ev_charging", "gas"]);
    const travel = mapCategory("cat:travel", TAX, "us.chase").map(
      (p) => p.kind === "category" && p.category,
    );
    expect(travel.sort()).toEqual(["airfare", "hotels", "portal_travel", "rideshare"]);
  });

  it("turns airline and brand categories into merchant matches", () => {
    expect(mapCategory("cat:travel.flights.direct.dl", TAX, "us.amex")).toEqual([
      {
        kind: "merchant",
        match: ["DELTA AIR", "DELTA.COM"],
        category: "airfare",
        from: "cat:travel.flights.direct.dl",
      },
    ]);
    expect(mapCategory("cat:merchant.red_cross", TAX, "us.chase")[0]?.kind).toBe("unmapped");
  });

  it("recognizes only the card issuer's own travel portal", () => {
    expect(mapCategory("cat:travel.portal.chase.flights", TAX, "us.chase")).toEqual([
      { kind: "portal", from: "cat:travel.portal.chase.flights", narrow: true },
    ]);
    expect(mapCategory("cat:travel.portal.amex", TAX, "us.chase")[0]?.kind).toBe("unmapped");
  });

  it("reports categories with no reward category", () => {
    expect(mapCategory("cat:apparel", TAX, "us.chase")[0]).toMatchObject({ kind: "unmapped" });
  });
});

describe("resolveForNewApplicant", () => {
  const card: OccbCard = {
    id: "us.chase.test",
    issuer_id: "us.chase",
    name: "Test",
    benefits: [],
    earn_rules: [
      {
        id: "us.chase.test/a",
        categories: ["cat:dining"],
        versions: [
          { version: 1, release: "x", multiplier: "2" },
          { version: 2, release: "y", multiplier: "3" },
        ],
      },
      {
        id: "us.chase.test/b",
        categories: ["cat:travel"],
        versions: [{ version: 1, release: "x", multiplier: "2", effective_to: "2026-01-01" }],
      },
      {
        id: "us.chase.test/c",
        categories: ["cat:gas_ev"],
        versions: [{ version: 1, release: "x", multiplier: "2" }],
      },
    ],
    releases: [
      {
        id: "us.chase.test@2027-01-01",
        card_id: "us.chase.test",
        kind: "change",
        effective_for_new: "2027-01-01",
        changes: [{ target: "fee:annual", to: { amount: 15000, currency: "USD" } }],
      },
      {
        id: "us.chase.test@2026-06-01",
        card_id: "us.chase.test",
        kind: "refresh",
        effective_for_new: "2026-06-01",
        changes: [
          { target: "earn_rule:us.chase.test/a", version: 2 },
          { target: "earn_rule:us.chase.test/c", change_type: "retired" },
        ],
      },
      {
        id: "us.chase.test@2024-01-01",
        card_id: "us.chase.test",
        kind: "baseline",
        effective_for_new: "2024-01-01",
        changes: [
          { target: "fee:annual", to: { amount: 9500, currency: "USD" } },
          { target: "fee:foreign_transaction", rate: "0.03" },
          { target: "earn_rule:us.chase.test/a", version: 1 },
          { target: "earn_rule:us.chase.test/b", version: 1 },
          { target: "earn_rule:us.chase.test/c", version: 1 },
        ],
      },
    ],
  };

  it("applies releases effective by the date, in order, and leaves out future ones", () => {
    const t = resolveForNewApplicant(card, "2026-11-21");
    expect(t.fees.annual).toBe(9500);
    expect(t.feeRates.foreign_transaction).toBe("0.03");
    expect(t.earn.map((e) => [e.id, e.v.multiplier])).toEqual([["us.chase.test/a", "3"]]);
    expect(t.upcoming.map((r) => r.effective_for_new)).toEqual(["2027-01-01"]);
  });

  it("sees the terms of an earlier date", () => {
    const t = resolveForNewApplicant(card, "2025-06-01");
    expect(t.earn.map((e) => [e.id, e.v.multiplier])).toEqual([
      ["us.chase.test/a", "2"],
      ["us.chase.test/b", "2"],
      ["us.chase.test/c", "2"],
    ]);
    expect(resolveForNewApplicant(card, "2027-02-01").fees.annual).toBe(15000);
  });
});

describe("convertEarn", () => {
  it("takes the base from an uncapped everything rule and converts caps to dollars", () => {
    const out = convertEarn(
      CHASE,
      [
        BASE,
        rule("dining", ["cat:dining"], {
          multiplier: "4",
          cap: { amount: 5_000_000, currency: "USD" },
          cap_period: "calendar_year",
        }),
      ],
      TAX,
    );
    expect(out.base).toBe(1);
    expect(out.earn).toEqual([
      {
        categories: ["dining"],
        channel: "any",
        multiplier: 4,
        cap: { amount: 50_000, period: "calendar_year" },
        afterCap: 1,
      },
    ]);
  });

  it("splits a rule into categories, the issuer's portal and merchants", () => {
    const out = convertEarn(
      CHASE,
      [
        BASE,
        rule("mix", ["cat:dining", "cat:travel.portal.chase", "cat:merchant.amazon"], {
          multiplier: "3",
        }),
      ],
      TAX,
    );
    expect(out.earn).toEqual([
      { categories: ["dining"], channel: "any", multiplier: 3 },
      { categories: ["portal_travel"], channel: "portal", multiplier: 3 },
      { categories: [], channel: "any", multiplier: 3, merchants: ["AMAZON", "AMZN"] },
    ]);
  });

  it("merges rules that share one cap at the same rate, and says when it can't", () => {
    const cap = { amount: 600_000, currency: "USD" };
    const shared = convertEarn(
      CHASE,
      [
        BASE,
        rule("a", ["cat:dining"], {
          multiplier: "3",
          cap,
          cap_period: "calendar_year",
          cap_group: "g",
        }),
        rule("b", ["cat:gas_ev.gas"], {
          multiplier: "3",
          cap,
          cap_period: "calendar_year",
          cap_group: "g",
        }),
      ],
      TAX,
    );
    expect(shared.earn).toHaveLength(1);
    expect(shared.earn[0]?.categories).toEqual(["dining", "gas"]);
    const unequal = convertEarn(
      CHASE,
      [
        BASE,
        rule("a", ["cat:dining"], { multiplier: "3", cap, cap_period: "quarter", cap_group: "g" }),
        rule("b", ["cat:gas_ev.gas"], {
          multiplier: "2",
          cap,
          cap_period: "quarter",
          cap_group: "g",
        }),
      ],
      TAX,
    );
    expect(unequal.earn).toHaveLength(2);
    expect(unequal.notes.join(" ")).toMatch(/share one cap; each is capped separately/);
  });

  it("drops boosts, other currencies, purchase-size conditions and channels, saying why", () => {
    const out = convertEarn(
      CHASE,
      [
        BASE,
        rule("boost", ["cat:all"], { boost: "0.25" }),
        rule("status", ["cat:all"], { multiplier: "0.05", currency: "pts:united_pqp" }),
        rule("big", ["cat:all"], {
          multiplier: "1.5",
          conditions: [{ type: "min_transaction", amount: 500_000 }],
        }),
        rule("via", ["cat:travel.hotels"], { multiplier: "5", channel: "renowned_hotels" }),
      ],
      TAX,
      (id) => (id === "pts:united_pqp" ? "United PQP" : id),
    );
    expect(out.earn).toEqual([]);
    expect(out.notes).toHaveLength(4);
    expect(out.notes.join(" ")).toMatch(/25% more on all earn/);
    expect(out.notes.join(" ")).toMatch(/United PQP/);
    expect(out.notes.join(" ")).toMatch(/purchases of \$5,000 or more/);
    expect(out.notes.join(" ")).toMatch(/renowned hotels/);
  });

  it("drops a payment-method rate on everything but keeps it on named merchants", () => {
    const out = convertEarn(
      CHASE,
      [
        BASE,
        rule("pay", ["cat:all"], {
          multiplier: "2",
          conditions: [{ type: "payment_method", method: "apple_pay" }],
        }),
        rule("partner", ["cat:merchant.amazon"], {
          multiplier: "3",
          conditions: [{ type: "payment_method", method: "apple_pay" }],
        }),
      ],
      TAX,
    );
    expect(out.earn).toEqual([
      {
        categories: [],
        channel: "any",
        multiplier: 3,
        merchants: ["AMAZON", "AMZN"],
        note: "Requires paying with apple pay.",
      },
    ]);
    expect(out.notes[0]).toMatch(/can't tell how a purchase was paid/);
  });

  it("folds a stacking rule into the base rate when nothing else overlaps", () => {
    const out = convertEarn(
      CHASE,
      [BASE, rule("stack", ["cat:travel.portal.chase"], { multiplier: "4", stacks: true })],
      TAX,
    );
    expect(out.earn).toHaveLength(1);
    expect(out.earn[0]).toMatchObject({
      categories: ["portal_travel"],
      channel: "portal",
      multiplier: 5,
    });
  });

  it("builds the rotating table from the schedule, leaving out single merchants", () => {
    const out = convertEarn(
      CHASE,
      [
        BASE,
        rule(
          "rot",
          ["cat:dining", "cat:gas_ev", "cat:merchant.red_cross"],
          {
            multiplier: "5",
            cap: { amount: 150_000, currency: "USD" },
            cap_period: "quarter",
            schedule: [
              {
                from: "2026-10-01",
                to: "2026-12-31",
                categories: ["cat:dining", "cat:merchant.red_cross"],
              },
              { from: "2027-01-01", to: "2027-03-31", categories: ["cat:gas_ev"] },
            ],
          },
          { choice: { mode: "rotating", period: "quarter" } },
        ),
      ],
      TAX,
    );
    expect(out.rotating).toEqual({ "2026-Q4": ["dining"], "2027-Q1": ["gas", "ev_charging"] });
    expect(out.earn).toEqual([
      {
        categories: [],
        channel: "any",
        multiplier: 5,
        cap: { amount: 1500, period: "quarter" },
        afterCap: 1,
        rotating: true,
      },
    ]);
    expect(out.notes.join(" ")).toMatch(/Red Cross/);
  });

  it("turns top-spend choices into a pick rule, leaving out narrower options", () => {
    const out = convertEarn(
      CHASE,
      [
        BASE,
        rule(
          "top",
          ["cat:dining", "cat:dining.fast_food", "cat:groceries.store"],
          { multiplier: "5", cap: { amount: 50_000, currency: "USD" }, cap_period: "statement" },
          {
            choice: {
              mode: "top_spend",
              pick: 1,
              groups: [
                { id: "dining", categories: ["cat:dining"] },
                { id: "fast_food", categories: ["cat:dining.fast_food"] },
                { id: "grocery", categories: ["cat:groceries.store"] },
              ],
            },
          },
        ),
      ],
      TAX,
    );
    expect(out.earn[0]).toMatchObject({
      pick: { mode: "top_spend", eligible: ["dining", "groceries"] },
      cap: { amount: 500, period: "month" },
    });
    expect(out.notes.join(" ")).toMatch(/fast food/);
    expect(out.notes.join(" ")).toMatch(/counted per month/);
  });

  it("turns a choice between categories into user_choice rules", () => {
    const pick = (value: string) => [{ type: "selection_is", name: "bonus_category", value }];
    const out = convertEarn(
      CHASE,
      [
        BASE,
        rule("dining", ["cat:dining"], { multiplier: "3", conditions: pick("dining") }),
        rule("grocery", ["cat:groceries.store"], { multiplier: "3", conditions: pick("grocery") }),
      ],
      TAX,
    );
    expect(out.earn.map((r) => r.pick)).toEqual([
      { mode: "user_choice", eligible: ["dining"] },
      { mode: "user_choice", eligible: ["groceries"] },
    ]);
  });

  it("keeps the highest of rates that depend on an option, and drops time windows", () => {
    const tier = (value: string) => [{ type: "selection_is", name: "tier", value }];
    const out = convertEarn(
      CHASE,
      [
        BASE,
        rule("t1", ["cat:rent", "cat:mortgage"], { multiplier: "0.5", conditions: tier("25") }),
        rule("t2", ["cat:rent", "cat:mortgage"], { multiplier: "1.25", conditions: tier("100") }),
        rule("nights", ["cat:dining"], {
          multiplier: "6",
          conditions: [{ type: "selection_is", name: "nights_window", value: true }],
        }),
      ],
      TAX,
    );
    expect(out.earn).toEqual([{ categories: ["rent"], channel: "any", multiplier: 1.25 }]);
    const notes = out.notes.join(" ");
    expect(notes).toMatch(/0\.5x, 1\.25x depending on/);
    expect(notes).toMatch(/Mortgage payments/);
    expect(notes).toMatch(/nights window/);
  });

  it("says when there is no base rate", () => {
    const out = convertEarn(CHASE, [rule("d", ["cat:dining"], { multiplier: "2" })], TAX);
    expect(out.base).toBe(0);
    expect(out.notes.join(" ")).toMatch(/base rate is 0/);
  });
});

describe("convertCard", () => {
  it("produces a card that passes the schema", () => {
    const card: OccbCard = {
      id: "us.chase.test",
      issuer_id: "us.chase",
      name: "Test Card",
      network: "visa",
      segment: "business",
      earns: "pts:chase_ur",
      url: "https://creditcards.chase.com/test",
      aliases: ["Test"],
      benefits: [],
      earn_rules: [
        {
          id: "us.chase.test/base",
          categories: ["cat:all"],
          versions: [{ version: 1, release: "us.chase.test@2024-01-01", multiplier: "1.5" }],
        },
      ],
      releases: [
        {
          id: "us.chase.test@2024-01-01",
          card_id: "us.chase.test",
          kind: "baseline",
          effective_for_new: "2024-01-01",
          changes: [
            { target: "fee:annual", to: { amount: 9500, currency: "USD" } },
            { target: "earn_rule:us.chase.test/base", version: 1 },
          ],
          sources: [{ url: "https://example.com/review", retrieved_at: "2026-11-01" }],
        },
      ],
    };
    const out = convertCard(card, "2026-11-21", {
      tax: TAX,
      issuerName: () => "Chase",
      currency: () => ({
        id: "pts:chase_ur",
        name: "Chase Ultimate Rewards",
        kind: "transferable",
      }),
    });
    expect(out.file).toBe("chase.json");
    const parsed = Card.parse(out.card);
    expect(parsed).toMatchObject({
      slug: "chase_test",
      issuer: "Chase",
      annualFee: 95,
      program: "chase_ur",
      base: 1.5,
      fxFeePercent: 3,
      business: true,
      verifiedAt: "2026-11-01",
    });
    expect(parsed.sources[0]?.url).toBe("https://creditcards.chase.com/test");
    expect(parsed.notes).toMatch(/3% is assumed/);
  });
});

describe("variants", () => {
  it("inherits the base card's rules under its own ids and follows its releases", () => {
    const base: OccbCard = {
      id: "us.amex.platinum",
      issuer_id: "us.amex",
      name: "Platinum",
      network: "amex",
      earns: "pts:amex_mr",
      benefits: [],
      earn_rules: [
        {
          id: "us.amex.platinum/flights",
          categories: ["cat:travel.flights"],
          versions: [{ version: 1, release: "us.amex.platinum@2024-01-01", multiplier: "5" }],
        },
      ],
      releases: [
        {
          id: "us.amex.platinum@2024-01-01",
          card_id: "us.amex.platinum",
          kind: "baseline",
          effective_for_new: "2024-01-01",
          changes: [
            { target: "fee:annual", to: { amount: 69500, currency: "USD" } },
            { target: "earn_rule:us.amex.platinum/flights", version: 1 },
          ],
        },
      ],
    };
    const variant: OccbCard = {
      id: "us.amex.platinum-x",
      name: "Platinum X",
      issuer_id: "us.amex",
      based_on: { card: "us.amex.platinum" },
      benefits: [],
      earn_rules: [],
      releases: [
        {
          id: "us.amex.platinum-x@2024-01-01",
          card_id: "us.amex.platinum-x",
          kind: "baseline",
          effective_for_new: "2024-01-01",
          follows: "us.amex.platinum@2024-01-01",
          changes: [],
        },
      ],
    };
    const v = expandVariant(variant, base);
    expect(v.network).toBe("amex");
    expect(v.earns).toBe("pts:amex_mr");
    const t = resolveForNewApplicant(v, "2026-11-21");
    expect(t.fees.annual).toBe(69500);
    expect(t.earn.map((e) => [e.id, e.v.multiplier])).toEqual([
      ["us.amex.platinum-x/flights", "5"],
    ]);
  });
});

describe("programs", () => {
  const ur: OccbCurrency = {
    id: "pts:chase_ur",
    name: "Chase Ultimate Rewards",
    kind: "transferable",
    url: "https://www.chase.com/ultimaterewards",
    paths: [
      { id: "cash", kind: "statement_credit", rate: "1.0" },
      { id: "boost", kind: "portal", rate: "1.5", requires: [{ type: "wallet_holds" }] },
      { id: "legacy", kind: "portal", rate: "1.25", effective_to: "2025-01-01" },
      { id: "gift", kind: "gift_card", rate: "1.1" },
    ],
  };

  it("takes the floor from the best fixed rate anyone can redeem at", () => {
    expect(floorPath(ur, "2026-11-21")).toMatchObject({ cpp: 1, path: { id: "cash" } });
    expect(floorPath({ ...ur, paths: [] }, "2026-11-21")).toEqual({ cpp: 0 });
  });

  it("uses the newest valuation, preferring a benchmark on the same day", () => {
    const vals = [
      {
        currency: "pts:chase_ur",
        cpp: "1.7",
        as_of: "2026-10-24",
        method: "benchmark",
        source: "https://a.example/",
      },
      {
        currency: "pts:chase_ur",
        cpp: "2.05",
        as_of: "2026-11-13",
        method: "benchmark",
        source: "https://thepointsguy.com/x",
      },
      {
        currency: "pts:chase_ur",
        cpp: "1.0",
        as_of: "2026-11-13",
        method: "floor",
        source: "https://b.example/",
      },
    ];
    expect(newestValuation(vals, "pts:chase_ur")?.cpp).toBe("2.05");
    const { program } = convertProgram(ur, vals, "2026-11-21");
    expect(Program.parse(program)).toMatchObject({
      slug: "chase_ur",
      kind: "transferable",
      floorCpp: 1,
      typicalCpp: 2.05,
      valuation: {
        source: "The Points Guy (OCCB value set)",
        url: "https://thepointsguy.com/x",
        asOf: "2026-11-13",
      },
    });
  });

  it("never puts the typical value below the floor", () => {
    const vals = [
      {
        currency: "pts:chase_ur",
        cpp: "0.8",
        as_of: "2026-11-13",
        method: "benchmark",
        source: "https://a.example/",
      },
    ];
    const { program, notes } = convertProgram(ur, vals, "2026-11-21");
    expect(program.typicalCpp).toBe(1);
    expect(notes[0]).toMatch(/below the 1¢ floor/);
  });
});
