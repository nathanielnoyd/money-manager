import { describe, expect, it } from "vitest";
import {
  addMonths,
  budgetLine,
  detectRecurring,
  endOfMonth,
  leftToBudget,
  monthlyCost,
  type RecurringInput,
  rolloverCarry,
  suggestBudget,
} from "./index";

describe("dates", () => {
  it("clamps month arithmetic", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
  });
});

describe("budget", () => {
  it("computes remaining, status and progress", () => {
    expect(budgetLine(50000, 20000)).toMatchObject({
      remaining: 30000,
      status: "under",
      progress: 0.4,
    });
    expect(budgetLine(50000, 45000).status).toBe("near");
    expect(budgetLine(50000, 60000)).toMatchObject({ remaining: -10000, status: "over" });
    expect(budgetLine(0, 1200).status).toBe("unbudgeted");
  });

  it("carries unspent and overspent amounts forward from the first budgeted month", () => {
    const history = [
      { month: "2026-07-01", budgeted: 0, spent: 9000 }, // before budgeting started: ignored
      { month: "2026-08-01", budgeted: 10000, spent: 6000 }, // +40
      { month: "2026-09-01", budgeted: 10000, spent: 13000 }, // −30
      { month: "2026-10-01", budgeted: 10000, spent: 10000 }, // 0
      { month: "2026-11-01", budgeted: 10000, spent: 1000 }, // current: excluded
    ];
    expect(rolloverCarry(history, "2026-11-01")).toBe(1000);
    expect(budgetLine(10000, 1000, 1000)).toMatchObject({ available: 11000, remaining: 10000 });
  });

  it("suggests budgets rounded up to $5 and tracks money left to assign", () => {
    expect(suggestBudget([40210, 38800, 45020])).toBe(41500);
    expect(suggestBudget([0, 0, 0])).toBe(0);
    expect(leftToBudget(800000, 750000)).toBe(50000);
  });
});

describe("detectRecurring", () => {
  const monthly = (
    merchantId: string,
    amounts: number[],
    startMonth = 1,
    day = 9,
  ): RecurringInput[] =>
    amounts.map((amount, i) => ({
      merchantId,
      date: `2026-${String(startMonth + i).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      amount,
      categoryId: "subs",
    }));

  it("finds a monthly subscription and its next date", () => {
    const [s] = detectRecurring(monthly("spotify", [-1199, -1199, -1199, -1199]), "2026-04-20");
    expect(s).toMatchObject({
      merchantId: "spotify",
      direction: "out",
      cadence: "monthly",
      expectedAmount: -1199,
      nextDate: "2026-05-09",
      occurrences: 4,
      priceChange: null,
      categoryId: "subs",
    });
  });

  it("flags a price increase on the latest charge", () => {
    const [s] = detectRecurring(monthly("netflix", [-1549, -1549, -1549, -1799]), "2026-04-20");
    expect(s?.priceChange).toBe(-250);
    expect(s?.expectedAmount).toBe(-1549);
  });

  it("detects biweekly paychecks as income", () => {
    const pay: RecurringInput[] = [
      "2026-01-02",
      "2026-01-16",
      "2026-01-30",
      "2026-02-13",
      "2026-02-27",
    ].map((date) => ({ merchantId: "acme", date, amount: 385042 }));
    const [s] = detectRecurring(pay, "2026-03-01");
    expect(s).toMatchObject({ direction: "in", cadence: "biweekly", nextDate: "2026-03-13" });
    expect(monthlyCost(s as never)).toBe(834258);
  });

  it("ignores irregular spending, wildly varying amounts, and lapsed subscriptions", () => {
    const coffee: RecurringInput[] = [
      "2026-01-02",
      "2026-01-03",
      "2026-01-09",
      "2026-01-21",
      "2026-02-02",
    ].map((date) => ({ merchantId: "cafe", date, amount: -450 }));
    const amazon = monthly("amzn", [-1200, -8900, -300, -15000]);
    const cancelled = monthly("gym", [-4500, -4500, -4500]);
    expect(detectRecurring([...coffee, ...amazon], "2026-04-20")).toEqual([]);
    expect(detectRecurring(cancelled, "2026-08-01")).toEqual([]);
  });

  it("doesn't treat weekly variable spending as a bill, or flag price changes on variable bills", () => {
    const gas: RecurringInput[] = [
      "2026-03-07",
      "2026-03-14",
      "2026-03-21",
      "2026-03-28",
      "2026-04-04",
    ].map((date, i) => ({
      merchantId: "chevron",
      date,
      amount: -([3850, 6120, 4410, 5390, 6800][i] as number),
    }));
    expect(detectRecurring(gas, "2026-04-06")).toEqual([]);
    const [power] = detectRecurring(monthly("pge", [-9500, -14200, -11800, -16900]), "2026-04-20");
    expect(power?.cadence).toBe("monthly");
    expect(power?.priceChange).toBeNull();
  });

  it("finds yearly renewals from two occurrences", () => {
    const yearly: RecurringInput[] = [
      { merchantId: "domain", date: "2025-03-14", amount: -1500 },
      { merchantId: "domain", date: "2026-03-15", amount: -1500 },
    ];
    expect(detectRecurring(yearly, "2026-06-01")[0]).toMatchObject({
      cadence: "yearly",
      nextDate: "2027-03-15",
    });
  });
});
