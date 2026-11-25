import { describe, expect, it } from "vitest";
import { allocation, assetClass, computeAlerts, modifiedDietz, unrealizedGain } from "./index";

describe("investments", () => {
  it("classifies securities and computes allocation", () => {
    expect(assetClass("etf")).toBe("Stocks");
    expect(assetClass("fixed income")).toBe("Bonds");
    expect(assetClass(null)).toBe("Other");
    expect(
      allocation([
        { type: "etf", value: 6000 },
        { type: "equity", value: 2000 },
        { type: "fixed income", value: 2000 },
      ]),
    ).toEqual([
      { assetClass: "Stocks", value: 8000, share: 0.8 },
      { assetClass: "Bonds", value: 2000, share: 0.2 },
    ]);
  });

  it("separates contributions from market gains (Modified Dietz)", () => {
    // $10,000 → $11,500 over a year with a $1,000 deposit halfway: $500 is market gain.
    const r = modifiedDietz(
      1_000_000,
      1_150_000,
      [{ date: "2026-07-02", amount: 100_000 }],
      "2026-01-01",
      "2026-12-31",
    );
    expect(r.netContributions).toBe(100_000);
    expect(r.gain).toBe(50_000);
    expect(r.returnPct).toBeCloseTo(50_000 / (1_000_000 + 100_000 * (182 / 364)), 6);
    expect(modifiedDietz(0, 0, [], "2026-01-01", "2026-02-01").returnPct).toBeNull();
  });

  it("reports unrealized gain only where cost basis is known", () => {
    expect(
      unrealizedGain([
        { value: 1200, costBasis: 1000 },
        { value: 500, costBasis: null },
      ]),
    ).toEqual({ basis: 1000, gain: 200, pct: 0.2, coverage: 0.5 });
  });
});

describe("computeAlerts", () => {
  const facts = {
    today: "2026-03-10",
    newTransactions: [
      { id: "t1", amount: -81_200, merchant: "Costco", account: "Visa", pending: false },
      { id: "t2", amount: -4_500, merchant: "Cafe", account: "Visa", pending: false },
      { id: "t3", amount: -90_000, merchant: "Hotel", account: "Visa", pending: true },
    ],
    cashAccounts: [
      { id: "chk", name: "Checking", balance: 12_000 },
      { id: "sav", name: "Savings", balance: 900_000 },
    ],
    priceIncreases: [
      { id: "r1", merchant: "Netflix", change: -250, newAmount: -1_799, lastDate: "2026-03-03" },
    ],
    brokenConnections: [
      { id: "c1", institution: "Chase", status: "needs_reauth", since: "2026-03-09" },
    ],
    overBudget: [{ categoryId: "g", category: "Groceries", month: "2026-03-01", over: 3_000 }],
  };

  it("fires only enabled alerts, ignores pending, and keys them for de-duplication", () => {
    const a = computeAlerts(
      {
        largeTransaction: 50_000,
        lowBalance: 50_000,
        priceIncreases: true,
        syncProblems: true,
        budgetOverspend: true,
      },
      facts,
    );
    expect(a.map((x) => [x.kind, x.key])).toEqual([
      ["large_transaction", "t1"],
      ["low_balance", "chk:2026-03-10"],
      ["price_increase", "r1:2026-03-03"],
      ["sync_problem", "c1:needs_reauth:2026-03-09"],
      ["budget_over", "g:2026-03-01"],
    ]);
    expect(a[0]?.body).toBe("$812.00 at Costco · Visa");
    expect(computeAlerts({}, facts)).toEqual([]);
  });

  it("can leave amounts out of messages for privacy", () => {
    const a = computeAlerts(
      { largeTransaction: 50_000, lowBalance: 50_000, includeAmounts: false },
      facts,
    );
    expect(a.map((x) => x.body).join(" ")).not.toMatch(/\$/);
  });
});
