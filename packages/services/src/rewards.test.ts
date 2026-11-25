import { schema, seedDemoData, withHousehold } from "@mm/db";
import { createTestDatabase, type TestDatabase, testDatabaseUrl } from "@mm/db/testing";
import { CATALOG } from "@mm/rewards";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bestCardFor,
  computeHouseholdRewards,
  execute,
  getRewardsSummary,
  getWallet,
  listRewardCategories,
  OperationError,
  type Principal,
  sessionPrincipal,
  setMerchantRewardCategory,
  setRewardCategory,
  setRewardValuation,
  setTransactionRewardCategory,
  setWalletCard,
} from "./index";

const adminUrl = testDatabaseUrl();
const RANGE = { start: "2026-01-01", end: "2026-06-30" };

describe("catalog", () => {
  it("ships validated cards that reference known programs", () => {
    expect(CATALOG.cards.length).toBeGreaterThan(5);
    const programs = new Set(CATALOG.programs.map((p) => p.slug));
    for (const c of CATALOG.cards) {
      expect(programs.has(c.program)).toBe(true);
      expect(c.sources.length).toBeGreaterThan(0);
    }
  });
});

describe.skipIf(!adminUrl)("rewards operations (integration)", () => {
  let t: TestDatabase;
  let hA: string;
  let hB: string;
  let owner: Principal;
  let cardAccount: string;
  let checking: string;
  let foreignAccount: string;
  const errorOf = (p: Promise<unknown>) => p.then(() => null).catch((e: unknown) => e);
  const summary = () => execute(t.app, owner, getRewardsSummary, RANGE);

  beforeAll(async () => {
    t = await createTestDatabase(adminUrl as string);
    hA = await t.household("A");
    hB = await t.household("B");
    await seedDemoData(t.app, hA, { months: 6, today: new Date("2026-06-30") });
    await seedDemoData(t.app, hB, { months: 1, today: new Date("2026-06-30") });
    const [m] = await t.admin
      .select()
      .from(schema.householdMembers)
      .where(eq(schema.householdMembers.householdId, hA));
    owner = sessionPrincipal({ userId: m?.userId as string, householdId: hA, role: "owner" });
    [cardAccount, checking] = await withHousehold(t.app, hA, async (tx) => {
      const [c] = await tx.select().from(schema.accounts).where(eq(schema.accounts.type, "credit"));
      const [d] = await tx
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.type, "depository"));
      return [c?.id as string, d?.id as string];
    });
    foreignAccount = await withHousehold(t.app, hB, async (tx) => {
      const [c] = await tx.select().from(schema.accounts).where(eq(schema.accounts.type, "credit"));
      return c?.id as string;
    });
  });
  afterAll(() => t?.cleanup());

  it("suggests a card for an unlinked credit account and earns nothing until linked", async () => {
    const w = await execute(t.app, owner, getWallet, {});
    expect(w.cards).toEqual([]);
    expect(w.unlinkedCreditAccounts).toHaveLength(1);
    expect((await summary()).transactions).toBe(0);
  });

  it("links only credit accounts in the household, to known cards", async () => {
    expect(
      await errorOf(
        execute(t.app, owner, setWalletCard, { accountId: checking, cardSlug: "citi_double_cash" }),
      ),
    ).toMatchObject({ code: "invalid_input" });
    expect(
      await errorOf(
        execute(t.app, owner, setWalletCard, { accountId: cardAccount, cardSlug: "nope" }),
      ),
    ).toMatchObject({ code: "not_found" });
    expect(
      await errorOf(
        execute(t.app, owner, setWalletCard, {
          accountId: foreignAccount,
          cardSlug: "citi_double_cash",
        }),
      ),
    ).toBeInstanceOf(OperationError);
    const viewer = { ...owner, role: "viewer" as const };
    expect(
      await errorOf(
        execute(t.app, viewer, setWalletCard, {
          accountId: cardAccount,
          cardSlug: "citi_double_cash",
        }),
      ),
    ).toMatchObject({ code: "forbidden" });
  });

  it("values purchases on a linked card and follows the valuation setting", async () => {
    await execute(t.app, owner, setWalletCard, {
      accountId: cardAccount,
      cardSlug: "capital_one_venture_x",
    });
    const s = await summary();
    expect(s.transactions).toBeGreaterThan(20);
    expect(s.byCard[0]?.card).toMatch(/Venture X/);
    // Venture X earns at least 2x on everything.
    expect(s.byCard[0]?.points).toBeGreaterThanOrEqual(Math.floor(s.spend * 2) - s.transactions);
    expect(s.missedValue).toBe(0); // one card: nothing better in the wallet

    await execute(t.app, owner, setRewardValuation, { valuation: "floor" });
    const floor = await summary();
    expect(floor.value).toBeLessThan(s.value);
    await execute(t.app, owner, setRewardValuation, {
      valuation: "typical",
      cpp: { capital_one_miles: 3 },
    });
    const custom = await summary();
    expect(custom.value).toBeGreaterThan(s.value);
    await execute(t.app, owner, setRewardValuation, { cpp: { capital_one_miles: null } });
    expect((await summary()).value).toBe(s.value);
  });

  it("maps categories, merchants and single transactions to reward categories", async () => {
    // Venture X earns 10x through Capital One Travel: make one purchase a portal booking.
    const { lines } = await withHousehold(t.app, hA, (tx) => computeHouseholdRewards(tx, RANGE));
    const txn = { id: lines.find((l) => l.category !== "portal_travel")?.transactionId };
    const before = await summary();
    await execute(t.app, owner, setTransactionRewardCategory, {
      transactionId: txn?.id as string,
      rewardCategory: "portal_travel",
    });
    const after = await summary();
    expect(after.byCategory.some((c) => c.category === "portal_travel")).toBe(true);
    expect(after.value).toBeGreaterThan(before.value);

    const cats = await execute(t.app, owner, listRewardCategories, {});
    const restaurants = cats.budgetCategories.find((c) => c.category === "Restaurants");
    expect(restaurants).toMatchObject({ rewardCategory: "dining", source: "default" });
    await execute(t.app, owner, setRewardCategory, {
      categoryId: restaurants?.categoryId as string,
      rewardCategory: "entertainment",
    });
    const remapped = await execute(t.app, owner, listRewardCategories, {});
    expect(remapped.budgetCategories.find((c) => c.category === "Restaurants")).toMatchObject({
      rewardCategory: "entertainment",
      source: "household",
    });

    expect(
      await errorOf(
        execute(t.app, owner, setMerchantRewardCategory, {
          merchant: "No Such Store",
          rewardCategory: "groceries",
        }),
      ),
    ).toMatchObject({ code: "not_found" });
  });

  it("ranks wallet cards for a purchase and spots a better card", async () => {
    const [second] = await withHousehold(t.app, hA, (tx) =>
      tx
        .insert(schema.accounts)
        .values({ householdId: hA, name: "Double Cash", type: "credit" })
        .returning({ id: schema.accounts.id }),
    );
    await execute(t.app, owner, setWalletCard, {
      accountId: second?.id as string,
      cardSlug: "citi_double_cash",
    });
    const r = await execute(t.app, owner, bestCardFor, {
      category: "everything_else",
      amount: 100,
    });
    expect(r.ranking).toHaveLength(2);
    expect(r.ranking[0]?.value).toBeGreaterThanOrEqual(r.ranking[1]?.value ?? 0);

    // Value miles at almost nothing: the 2% card becomes better for everything on Venture X.
    await execute(t.app, owner, setRewardValuation, { cpp: { capital_one_miles: 0.1 } });
    const s = await summary();
    expect(s.missedValue).toBeGreaterThan(0);
    expect(s.bestPossibleValue).toBeGreaterThan(s.value);
  });

  it("keeps another household's wallet invisible", async () => {
    const other = sessionPrincipal({ userId: owner.userId, householdId: hB, role: "owner" });
    const w = await execute(t.app, other, getWallet, {});
    expect(w.cards).toEqual([]);
  });
});
