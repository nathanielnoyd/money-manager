import { describe, expect, it } from "vitest";
import { categoryAnomalies, unusualCharges } from "./index";

describe("anomalies", () => {
  it("flags categories well above their typical level, ignoring small or new ones", () => {
    const r = categoryAnomalies(
      [
        { category: "Restaurants", spent: 30_000 },
        { category: "Groceries", spent: 21_000 },
        { category: "Coffee", spent: 3_000 },
        { category: "Travel", spent: 90_000 },
      ],
      [
        { category: "Restaurants", spent: [15_000, 18_000, 12_000] },
        { category: "Groceries", spent: [20_000, 19_000, 22_000] },
        { category: "Coffee", spent: [1_000, 1_200, 900] },
        { category: "Travel", spent: [0] },
      ],
    );
    expect(r).toEqual([{ category: "Restaurants", current: 30_000, typical: 15_000, ratio: 2 }]);
  });

  it("ignores monthly bills and occasional spending in week-over-week comparisons", () => {
    const r = categoryAnomalies(
      [
        { category: "Utilities", spent: 10_200 },
        { category: "Entertainment", spent: 8_700 },
      ],
      [
        { category: "Utilities", spent: [0, 0, 0, 10_000, 0, 0, 0, 0] },
        { category: "Entertainment", spent: [0, 4_000, 0, 0, 3_500, 0, 4_500, 0] },
      ],
    );
    expect(r).toEqual([]);
  });

  it("flags one-off charges far above a merchant's usual amount", () => {
    expect(
      unusualCharges([
        { id: "a", merchant: "Amazon", amount: 45_000, history: [2_000, 3_500, 1_800, 4_000] },
        { id: "b", merchant: "Shell", amount: 6_000, history: [5_000, 5_500, 4_800] },
        { id: "c", merchant: "New Shop", amount: 90_000, history: [] },
      ]),
    ).toEqual([{ id: "a", merchant: "Amazon", amount: 45_000, typical: 3_500 }]);
  });
});
