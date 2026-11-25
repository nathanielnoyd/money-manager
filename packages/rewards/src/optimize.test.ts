import { describe, expect, it } from "vitest";
import { capUsage, type EngineTransaction, type WalletCard } from "./engine";
import { annualize, bestTotal, marginalValues, simulateCandidates } from "./optimize";
import { nextAnniversary, rewardReminders } from "./reminders";
import { Card } from "./schema";

const card = (c: Record<string, unknown>) =>
  Card.parse({
    issuer: "Test Bank",
    network: "visa",
    annualFee: 0,
    fxFeePercent: 0,
    sources: [{ url: "https://example.com/card" }],
    verifiedAt: "2026-11-01",
    earn: [],
    ...c,
  });

const twoPct = card({ slug: "two", name: "Two Percent", program: "cash_back", base: 2 });
const dining = card({
  slug: "dining",
  name: "Dining Card",
  program: "pts",
  base: 1,
  annualFee: 95,
  earn: [{ categories: ["dining"], multiplier: 4, cap: { amount: 1000, period: "calendar_year" } }],
});
const valuation = (p: string) => (p === "pts" ? 2 : 1);

let n = 0;
const tx = (amount: number, category: EngineTransaction["category"], date = "2026-05-01") => ({
  id: `t${String(++n).padStart(4, "0")}`,
  accountId: "a1",
  date,
  amount,
  merchant: "",
  description: "",
  category,
});
const spend = [tx(-50000, "dining"), tx(-100000, "everything_else"), tx(-20000, "dining")];

describe("bestTotal", () => {
  it("puts each purchase on the best card, respecting caps", () => {
    // Dining: $700 at 4×2¢ = 8% → $56 (under the $1,000 cap); everything else 2% → $20.
    expect(
      bestTotal(
        [
          { id: "a", card: twoPct },
          { id: "b", card: dining },
        ],
        spend,
        valuation,
      ),
    ).toBe(7600);
    expect(bestTotal([], spend, valuation)).toBe(0);
  });
});

describe("marginalValues", () => {
  it("measures what each card adds to the rest of the wallet", () => {
    const wallet: WalletCard[] = [
      { id: "a", accountId: "a1", card: twoPct },
      { id: "b", accountId: "a2", card: dining },
    ];
    const m = marginalValues(wallet, spend, valuation);
    // Without the dining card: everything at 2% = $34. With it: $76. It adds $42.
    expect(m.get("b")).toBe(4200);
    // The dining card's base (1x at 2¢) already matches 2%, so the 2% card adds nothing.
    expect(m.get("a")).toBe(0);
  });
});

describe("simulateCandidates", () => {
  it("reports the extra value a new card would add", () => {
    const wallet: WalletCard[] = [{ id: "a", accountId: "a1", card: twoPct }];
    const [r] = simulateCandidates(wallet, [dining], spend, valuation);
    expect(r?.gainCents).toBe(4200);
  });
});

describe("annualize", () => {
  it("scales short histories, at most 4x", () => {
    expect(annualize(1000, 365)).toBe(1000);
    expect(annualize(1000, 73)).toBe(4000);
    expect(annualize(1000, 30)).toBe(4000);
    expect(annualize(1000, 0)).toBe(0);
  });
});

describe("capUsage", () => {
  it("reports how much of a cap the current period has used", () => {
    const wc: WalletCard = { id: "b", accountId: "a1", card: dining };
    const [u] = capUsage(
      wc,
      [
        tx(-50000, "dining", "2026-03-01"),
        tx(-45000, "dining", "2026-04-01"),
        tx(-90000, "dining", "2025-06-01"),
      ],
      "2026-05-01",
    );
    expect(u).toMatchObject({ periodKey: "2026", spentCents: 95000, capCents: 100000 });
  });
});

describe("rewardReminders", () => {
  const base = { today: "2026-11-09", stale: [], includeAmounts: true };
  const c = { walletCardId: "w1", name: "Flex", account: "Flex ••1", caps: [] };

  it("reminds about unactivated rotating categories once per quarter", () => {
    const r = rewardReminders({
      ...base,
      cards: [
        { ...c, rotating: { quarter: "2026-Q4", categories: ["groceries"], activated: false } },
      ],
    });
    expect(r).toEqual([expect.objectContaining({ key: "activate:w1:2026-Q4" })]);
    expect(
      rewardReminders({
        ...base,
        cards: [
          { ...c, rotating: { quarter: "2026-Q4", categories: ["groceries"], activated: true } },
        ],
      }),
    ).toEqual([]);
  });

  it("flags caps at 90% and when reached", () => {
    const cap = (spentCents: number) =>
      rewardReminders({
        ...base,
        cards: [
          {
            ...c,
            caps: [
              { ruleIndex: 0, label: "groceries", periodKey: "2026", spentCents, capCents: 100000 },
            ],
          },
        ],
      });
    expect(cap(80000)).toEqual([]);
    expect(cap(92000)[0]?.title).toMatch(/almost reached/);
    expect(cap(100000)[0]?.title).toMatch(/reached/);
  });

  it("counts down sign-up bonus deadlines and hides amounts when asked", () => {
    const bonus = (today: string, spentCents: number, includeAmounts = true) =>
      rewardReminders({
        ...base,
        today,
        includeAmounts,
        cards: [
          {
            ...c,
            bonus: { points: 60000, minSpendCents: 400000, spentCents, deadline: "2026-12-01" },
          },
        ],
      });
    expect(bonus("2026-10-01", 100000)).toEqual([]);
    expect(bonus("2026-11-09", 100000)[0]).toMatchObject({
      key: "bonus:w1:2026-12-01:30",
      priority: "default",
    });
    expect(bonus("2026-11-28", 100000)[0]).toMatchObject({
      key: "bonus:w1:2026-12-01:7",
      priority: "high",
    });
    expect(bonus("2026-11-28", 100000, false)[0]?.body).not.toMatch(/\$/);
    expect(bonus("2026-11-28", 400000)[0]?.key).toBe("bonus-met:w1:2026-12-01");
  });

  it("warns before an annual fee with the card's net value", () => {
    const r = rewardReminders({
      ...base,
      cards: [
        { ...c, fee: { annualFeeCents: 9500, nextFeeDate: "2026-11-30", netValueCents: -2000 } },
      ],
    });
    expect(r[0]?.body).toMatch(/less than its fee/);
    expect(
      rewardReminders({
        ...base,
        cards: [{ ...c, fee: { annualFeeCents: 9500, nextFeeDate: "2027-02-01" } }],
      }),
    ).toEqual([]);
  });
});

describe("nextAnniversary", () => {
  it("finds the next anniversary on or after today", () => {
    expect(nextAnniversary("2023-12-15", "2026-11-09")).toBe("2026-12-15");
    expect(nextAnniversary("2023-03-01", "2026-11-09")).toBe("2027-03-01");
    expect(nextAnniversary("2024-11-09", "2026-11-09")).toBe("2026-11-09");
    expect(nextAnniversary("2024-02-29", "2026-11-09")).toBe("2027-02-28");
  });
});
