import { addDays, todayIso } from "@mm/core";
import { schema, seedDemoData, withHousehold } from "@mm/db";
import { createTestDatabase, type TestDatabase, testDatabaseUrl } from "@mm/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  execute,
  getCardValues,
  getCheatSheet,
  getMissedValue,
  getSignupBonusProgress,
  listPointsBalances,
  type Principal,
  recommendCards,
  sessionPrincipal,
  setCardCredits,
  setPointsBalance,
  setSignupBonus,
  setWalletCard,
  simulateCard,
} from "./index";

const adminUrl = testDatabaseUrl();

describe.skipIf(!adminUrl)("rewards optimization (integration)", () => {
  let t: TestDatabase;
  let owner: Principal;
  let sapphire: string;
  let doubleCash: string;
  const today = todayIso();
  const errorOf = (p: Promise<unknown>) => p.then(() => null).catch((e: unknown) => e);

  beforeAll(async () => {
    t = await createTestDatabase(adminUrl as string);
    const h = await t.household("A");
    await seedDemoData(t.app, h, { months: 6 });
    const [m] = await t.admin
      .select()
      .from(schema.householdMembers)
      .where(eq(schema.householdMembers.householdId, h));
    owner = sessionPrincipal({ userId: m?.userId as string, householdId: h, role: "owner" });
    [sapphire, doubleCash] = await withHousehold(t.app, h, async (tx) => {
      const [c] = await tx.select().from(schema.accounts).where(eq(schema.accounts.type, "credit"));
      const [d] = await tx
        .insert(schema.accounts)
        .values({ householdId: h, name: "Double Cash", type: "credit" })
        .returning();
      return [c?.id as string, d?.id as string];
    });
    await execute(t.app, owner, setWalletCard, {
      accountId: sapphire,
      cardSlug: "chase_sapphire_preferred",
      openedOn: addDays(today, -340),
    });
    await execute(t.app, owner, setWalletCard, {
      accountId: doubleCash,
      cardSlug: "citi_double_cash",
    });
  });
  afterAll(() => t?.cleanup());

  it("picks the best wallet card per category", async () => {
    const sheet = await execute(t.app, owner, getCheatSheet, {});
    const by = new Map(sheet.categories.map((c) => [c.category, c]));
    expect(by.get("dining")?.card).toBe("Sapphire Preferred");
    expect(by.get("dining")?.rate).toBe("3x");
    expect(by.get("everything_else")?.card).toBe("Citi Double Cash Card");
    expect(by.get("everything_else")?.runnerUp).toBe("Sapphire Preferred");
  });

  it("shows what was left on the table and which card to use", async () => {
    // All the seeded spend is on the Sapphire; Double Cash beats it outside its bonus categories.
    const r = await execute(t.app, owner, getMissedValue, {
      start: addDays(today, -180),
      end: today,
    });
    expect(r.missed).toBeGreaterThan(0);
    expect(r.bestPossible).toBeCloseTo(r.earned + r.missed, 2);
    expect(r.byCategory[0]?.useCard).toBe("Citi Double Cash Card");
    expect(r.suggestions[0]).toMatch(/^Use Citi Double Cash Card for /);
    expect(r.biggestMisses.length).toBeGreaterThan(0);
  });

  it("weighs each card's value against its fee, counting credits", async () => {
    const before = await execute(t.app, owner, getCardValues, {});
    const csp = before.cards.find((c) => c.card === "Sapphire Preferred");
    expect(csp).toMatchObject({ annualFee: 95, creditsUsedPerYear: 0 });
    expect(csp?.nextFeeDate).toBe(addDays(today, 25));
    expect(before.cards.find((c) => c.card === "Citi Double Cash Card")?.verdict).toBe("no fee");
    await execute(t.app, owner, setCardCredits, { accountId: sapphire, creditsPerYear: 50 });
    const after = await execute(t.app, owner, getCardValues, {});
    const csp2 = after.cards.find((c) => c.card === "Sapphire Preferred");
    expect(csp2?.netPerYear).toBeCloseTo((csp?.netPerYear ?? 0) + 50, 2);
  });

  it("recommends cards not in the wallet and simulates one", async () => {
    const r = await execute(t.app, owner, recommendCards, { limit: 5 });
    expect(r.cards.length).toBeGreaterThan(0);
    expect(r.cards.length).toBeLessThanOrEqual(5);
    const slugs = r.cards.map((c) => c.slug);
    expect(slugs).not.toContain("chase_sapphire_preferred");
    expect(slugs).not.toContain("citi_double_cash");
    expect(r.cards.every((c) => !c.business)).toBe(true);
    const nets = r.cards.map((c) => c.netPerYear);
    expect([...nets].sort((a, b) => b - a)).toEqual(nets);
    const top = r.cards[0];
    expect(top?.netPerYear).toBeCloseTo((top?.extraRewardsPerYear ?? 0) - (top?.annualFee ?? 0), 2);

    const sim = await execute(t.app, owner, simulateCard, { slug: "amex_gold" });
    expect(sim.slug).toBe("amex_gold");
    expect(Array.isArray(sim.categoriesItWouldWin)).toBe(true);
    expect(await errorOf(execute(t.app, owner, simulateCard, { slug: "nope" }))).toMatchObject({
      code: "not_found",
    });
  });

  it("records points balances and values them", async () => {
    await execute(t.app, owner, setPointsBalance, { program: "chase_ur", balance: 100_000 });
    const r = await execute(t.app, owner, listPointsBalances, {});
    expect(r.balances[0]).toMatchObject({ slug: "chase_ur", balance: 100_000, value: 2050 });
    expect(r.total).toBe(2050);
    expect(
      await errorOf(execute(t.app, owner, setPointsBalance, { program: "cash_back", balance: 5 })),
    ).toMatchObject({ code: "not_found" });
    await execute(t.app, owner, setPointsBalance, { program: "chase_ur", balance: null });
    expect((await execute(t.app, owner, listPointsBalances, {})).balances).toEqual([]);
  });

  it("tracks sign-up bonus progress on wallet cards only", async () => {
    await execute(t.app, owner, setSignupBonus, {
      accountId: sapphire,
      bonus: {
        points: 75_000,
        minSpend: 1_000_000,
        deadline: addDays(today, 60),
        startDate: addDays(today, -30),
      },
    });
    const [b] = (await execute(t.app, owner, getSignupBonusProgress, {})).bonuses;
    expect(b).toMatchObject({
      card: "Sapphire Preferred",
      status: "in progress",
      daysLeft: 60,
    });
    expect(b?.spent).toBeGreaterThan(0);
    expect(b?.remaining).toBeCloseTo(1_000_000 - (b?.spent ?? 0), 2);
    expect(b).not.toHaveProperty("spentCents");

    // No opening date and no start: spend counts from today, so nothing is spent yet.
    const r = await execute(t.app, owner, setSignupBonus, {
      accountId: doubleCash,
      bonus: { points: 20_000, minSpend: 500, deadline: addDays(today, 90) },
    });
    expect(r.bonus?.startDate).toBe(today);

    const [plain] = await withHousehold(t.app, owner.householdId, (tx) =>
      tx
        .insert(schema.accounts)
        .values({ householdId: owner.householdId, name: "Unlinked", type: "credit" })
        .returning(),
    );
    expect(
      await errorOf(
        execute(t.app, owner, setSignupBonus, {
          accountId: plain?.id as string,
          bonus: { points: 1, minSpend: 1, deadline: today },
        }),
      ),
    ).toMatchObject({ code: "not_found" });
  });
});
