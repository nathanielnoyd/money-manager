import { describe, expect, it } from "vitest";
import {
  computeRewards,
  type EngineTransaction,
  periodKey,
  suggestCards,
  type WalletCard,
} from "./engine";
import { Card } from "./schema";

const card = (c: Record<string, unknown>) =>
  Card.parse({
    issuer: "Test Bank",
    network: "visa",
    annualFee: 0,
    fxFeePercent: 0,
    sources: [{ url: "https://example.com/card" }],
    verifiedAt: "2026-11-01",
    ...c,
  });

const points = card({
  slug: "points_card",
  name: "Points Card",
  program: "test_points",
  base: 1,
  earn: [
    { categories: ["dining"], multiplier: 4 },
    {
      categories: ["groceries"],
      multiplier: 4,
      cap: { amount: 100, period: "calendar_year" },
      excludeMerchants: ["WALMART"],
    },
    { categories: [], merchants: ["DELTA"], multiplier: 3 },
    { categories: ["portal_travel"], channel: "portal", multiplier: 8 },
  ],
});
const cash = card({
  slug: "cash_card",
  name: "Cash Card",
  program: "cash_back",
  base: 2,
  earn: [],
});
const rotating = card({
  slug: "rotating_card",
  name: "Rotating Card",
  program: "cash_back",
  base: 1,
  earn: [
    { categories: [], rotating: true, multiplier: 5, cap: { amount: 1500, period: "quarter" } },
  ],
  rotating: { "2026-Q4": ["gas"] },
});
const custom = card({
  slug: "custom_card",
  name: "Custom Card",
  program: "cash_back",
  base: 1,
  earn: [
    {
      categories: [],
      pick: { mode: "top_spend", eligible: ["dining", "gas"] },
      multiplier: 5,
      cap: { amount: 500, period: "month" },
    },
  ],
});

const valuation = (p: string) => (p === "test_points" ? 1.5 : 1);
let n = 0;
const tx = (
  accountId: string,
  amount: number,
  category: EngineTransaction["category"],
  date = "2026-11-02",
  merchant = "Somewhere",
): EngineTransaction => ({
  id: `t${String(++n).padStart(4, "0")}`,
  accountId,
  date,
  amount,
  merchant,
  description: merchant.toUpperCase(),
  category,
});

const wallet: WalletCard[] = [
  { id: "w-points", accountId: "a-points", card: points },
  { id: "w-cash", accountId: "a-cash", card: cash },
];

describe("computeRewards", () => {
  it("applies category rates and values points", () => {
    const [r] = computeRewards({
      wallet,
      valuation,
      transactions: [tx("a-points", -1000, "dining")],
    });
    expect(r).toMatchObject({
      points: 40,
      multiplier: 4,
      valueCents: 60,
      walletCardId: "w-points",
    });
  });

  it("splits a purchase that crosses a cap and blends the rate", () => {
    const r = computeRewards({
      wallet,
      valuation,
      transactions: [
        tx("a-points", -8000, "groceries", "2026-03-01"),
        tx("a-points", -5000, "groceries", "2026-03-02"),
        tx("a-points", -1000, "groceries", "2027-01-02"),
      ],
    });
    expect(r.map((x) => x.points)).toEqual([320, 110, 40]); // $20×4 + $30×1, then a new year
    expect(r[1]?.multiplier).toBe(2.2);
  });

  it("takes points back on refunds", () => {
    const [r] = computeRewards({
      wallet,
      valuation,
      transactions: [tx("a-points", 1000, "dining")],
    });
    expect(r?.points).toBe(-40);
    expect(r?.valueCents).toBe(-60);
  });

  it("respects merchant rules, exclusions and portal-only rates", () => {
    const r = computeRewards({
      wallet,
      valuation,
      transactions: [
        tx("a-points", -10000, "airfare", "2026-11-03", "Delta Air Lines"),
        tx("a-points", -10000, "groceries", "2026-11-03", "Walmart Supercenter"),
        tx("a-points", -10000, "airfare", "2026-11-03", "United"),
        tx("a-points", -10000, "portal_travel", "2026-11-03", "Card Travel"),
      ],
    });
    expect(r.map((x) => x.points)).toEqual([300, 100, 100, 800]);
  });

  it("finds the better card in the wallet", () => {
    const r = computeRewards({
      wallet,
      valuation,
      transactions: [tx("a-points", -10000, "everything_else"), tx("a-cash", -10000, "dining")],
    });
    // Points card earns 100 × 1.5¢ = $1.50; the 2% card would have earned $2.00.
    expect(r[0]).toMatchObject({
      valueCents: 150,
      bestWalletCardId: "w-cash",
      bestValueCents: 200,
    });
    // Dining: 4 × 1.5¢ = 6% beats 2%.
    expect(r[1]).toMatchObject({
      valueCents: 200,
      bestWalletCardId: "w-points",
      bestValueCents: 600,
    });
  });

  it("only pays rotating rates for activated quarters", () => {
    const run = (activations: string[]) =>
      computeRewards({
        valuation,
        wallet: [{ id: "w-rot", accountId: "a-rot", card: rotating, activations }],
        transactions: [
          tx("a-rot", -2000, "gas", "2026-11-05"),
          tx("a-rot", -2000, "dining", "2026-11-05"),
        ],
      }).map((x) => x.points);
    expect(run([])).toEqual([20, 20]);
    expect(run(["2026-Q4"])).toEqual([100, 20]);
  });

  it("applies top-spend rates to the biggest eligible category each period", () => {
    const r = computeRewards({
      valuation,
      wallet: [{ id: "w-cc", accountId: "a-cc", card: custom }],
      transactions: [
        tx("a-cc", -30000, "dining", "2026-10-01"),
        tx("a-cc", -10000, "gas", "2026-10-02"),
        tx("a-cc", -5000, "dining", "2026-11-01"),
        tx("a-cc", -9000, "gas", "2026-11-02"),
      ],
    });
    expect(r.map((x) => x.points)).toEqual([1500, 100, 50, 450]);
  });

  it("ignores accounts without a wallet card and zero amounts", () => {
    const r = computeRewards({
      wallet,
      valuation,
      transactions: [tx("a-other", -1000, "dining"), tx("a-points", 0, "dining")],
    });
    expect(r).toEqual([]);
  });
});

describe("periodKey", () => {
  it("keys cardmember years from the opening date", () => {
    expect(periodKey("cardmember_year", "2026-03-14", "2024-03-15")).toBe("cm1");
    expect(periodKey("cardmember_year", "2026-03-15", "2024-03-15")).toBe("cm2");
    expect(periodKey("cardmember_year", "2026-03-15", null)).toBe("2026");
    expect(periodKey("quarter", "2026-11-30")).toBe("2026-Q4");
  });
});

describe("suggestCards", () => {
  const sapphire = card({
    slug: "sapphire",
    issuer: "Chase",
    name: "Sapphire Reserve®",
    program: "x",
    base: 1,
    earn: [],
    aliases: ["CSR"],
  });
  const freedom = card({
    slug: "freedom",
    issuer: "Chase",
    name: "Freedom Unlimited",
    program: "x",
    base: 1,
    earn: [],
  });
  it("matches bank account names to catalog cards", () => {
    expect(suggestCards("CHASE SAPPHIRE RESERVE (...1234)", [freedom, sapphire])[0]?.slug).toBe(
      "sapphire",
    );
    expect(suggestCards("Freedom Unlimited", [freedom, sapphire])[0]?.slug).toBe("freedom");
    expect(suggestCards("Checking", [freedom, sapphire])).toEqual([]);
  });
});
