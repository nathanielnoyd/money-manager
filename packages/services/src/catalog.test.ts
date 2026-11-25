import { addDays, todayIso } from "@mm/core";
import { schema, seedDemoData, withHousehold } from "@mm/db";
import { createTestDatabase, type TestDatabase, testDatabaseUrl } from "@mm/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addCustomCard,
  execute,
  exportCatalogPatch,
  getCard,
  getCardValues,
  getCatalogStaleness,
  getCheatSheet,
  listCatalogChanges,
  listRewardPrograms,
  OperationError,
  type Principal,
  resetCatalogEntry,
  revertCatalogChange,
  reviewCatalogChange,
  SCOPES,
  sessionPrincipal,
  setCatalogApproval,
  setProgramValuation,
  setWalletCard,
  updateCard,
  workerPrincipal,
} from "./index";

const adminUrl = testDatabaseUrl();
const SRC = "https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred";

describe.skipIf(!adminUrl)("agent-maintained catalog (integration)", () => {
  let t: TestDatabase;
  let owner: Principal;
  let agent: Principal;
  let other: Principal;
  let sapphire: string;
  let extra: string;
  const today = todayIso();
  const errorOf = (p: Promise<unknown>) =>
    p.then(() => null).catch((e: unknown) => e as OperationError);

  beforeAll(async () => {
    t = await createTestDatabase(adminUrl as string);
    const [hA, hB] = [await t.household("A"), await t.household("B")];
    await seedDemoData(t.app, hA, { months: 3 });
    const member = async (h: string) => {
      const [m] = await t.admin
        .select()
        .from(schema.householdMembers)
        .where(eq(schema.householdMembers.householdId, h));
      return m?.userId as string;
    };
    owner = sessionPrincipal({ userId: await member(hA), householdId: hA, role: "owner" });
    agent = {
      ...owner,
      role: "member",
      via: "token",
      tokenId: "00000000-0000-7000-8000-00000000abcd",
      scopes: SCOPES,
    };
    other = sessionPrincipal({ userId: await member(hB), householdId: hB, role: "owner" });
    [sapphire, extra] = await withHousehold(t.app, hA, async (tx) => {
      const [c] = await tx.select().from(schema.accounts).where(eq(schema.accounts.type, "credit"));
      const [d] = await tx
        .insert(schema.accounts)
        .values({ householdId: hA, name: "Credit union card", type: "credit" })
        .returning();
      return [c?.id as string, d?.id as string];
    });
    await execute(t.app, owner, setWalletCard, {
      accountId: sapphire,
      cardSlug: "chase_sapphire_preferred",
    });
  });
  afterAll(() => t?.cleanup());

  it("applies an agent's sourced edit to this household only, with history", async () => {
    const card = await execute(t.app, owner, getCard, { slug: "chase_sapphire_preferred" });
    const earn = card.earn.map((r) =>
      r.categories.includes("dining") ? { ...r, multiplier: 5 } : r,
    );
    const r = await execute(t.app, agent, updateCard, {
      slug: "chase_sapphire_preferred",
      patch: { earn, annualFee: 105 },
      sourceUrl: SRC,
      asOf: today,
      note: "Dining now 5x",
    });
    expect(r).toMatchObject({
      status: "applied",
      changedFields: expect.arrayContaining(["earn", "annualFee"]),
    });

    const after = await execute(t.app, owner, getCard, { slug: "chase_sapphire_preferred" });
    expect(after.annualFee).toBe(105);
    expect(after.verifiedAt).toBe(today);
    expect(after.sources[0]?.url).toBe(SRC);
    expect(after.household?.defaults).toMatchObject({ annualFee: card.annualFee });
    const sheet = await execute(t.app, owner, getCheatSheet, {});
    expect(sheet.categories.find((c) => c.category === "dining")?.rate).toBe("5x");
    const values = await execute(t.app, owner, getCardValues, {});
    expect(values.cards[0]?.annualFee).toBe(105);

    // Household B still sees the shipped card.
    const b = await execute(t.app, other, getCard, { slug: "chase_sapphire_preferred" });
    expect(b.annualFee).toBe(card.annualFee);
    expect(b.household).toBeUndefined();

    const { changes } = await execute(t.app, owner, listCatalogChanges, {});
    expect(changes[0]).toMatchObject({
      slug: "chase_sapphire_preferred",
      status: "applied",
      via: "token",
      sourceUrl: SRC,
      note: "Dining now 5x",
      fields: ["annualFee", "earn"],
    });
    const audit = await t.admin
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "agent.write"));
    expect(
      audit.some((a) => (a.detail as { operation?: string }).operation === "update_card"),
    ).toBe(true);
  });

  it("rejects edits without a usable source or outside sane bounds", async () => {
    const base = { slug: "chase_sapphire_preferred", asOf: today };
    const bad = [
      { ...base, patch: { annualFee: 1 }, sourceUrl: "http://example.com" },
      { ...base, patch: { earn: [{ categories: ["dining"], multiplier: 40 }] }, sourceUrl: SRC },
      { ...base, patch: { program: "no_such_program" }, sourceUrl: SRC },
      { ...base, patch: { annualFee: 1 }, sourceUrl: SRC, asOf: addDays(today, 3) },
      { ...base, patch: { slug: "renamed" }, sourceUrl: SRC },
    ];
    for (const input of bad) {
      const e = await errorOf(execute(t.app, agent, updateCard, input));
      expect(e, JSON.stringify(input)).toBeInstanceOf(OperationError);
    }
    const missing = await errorOf(
      execute(t.app, agent, updateCard, { ...base, slug: "nope", patch: {}, sourceUrl: SRC }),
    );
    expect(missing?.code).toBe("not_found");
  });

  it("records a check with no changes, then undoes changes newest first", async () => {
    const check = await execute(t.app, agent, updateCard, {
      slug: "chase_sapphire_preferred",
      patch: {},
      sourceUrl: `${SRC}/rates-and-fees`,
      asOf: today,
    });
    expect(check.message).toMatch(/checked/);
    const { changes } = await execute(t.app, owner, listCatalogChanges, {
      slug: "chase_sapphire_preferred",
    });
    const [latest, edit] = changes;
    const tooOld = await errorOf(
      execute(t.app, agent, revertCatalogChange, { changeId: edit?.changeId as string }),
    );
    expect(tooOld?.code).toBe("conflict");
    await execute(t.app, agent, revertCatalogChange, { changeId: latest?.changeId as string });
    await execute(t.app, agent, revertCatalogChange, { changeId: edit?.changeId as string });
    const card = await execute(t.app, owner, getCard, { slug: "chase_sapphire_preferred" });
    expect(card.household).toBeUndefined();
    const statuses = (
      await execute(t.app, owner, listCatalogChanges, { slug: "chase_sapphire_preferred" })
    ).changes.map((c) => `${c.action}:${c.status}`);
    expect(statuses).toEqual([
      "revert:applied",
      "revert:applied",
      "update:reverted",
      "update:reverted",
    ]);
  });

  it("holds agent edits for approval when the household asks, and only people can approve", async () => {
    expect(
      (await errorOf(execute(t.app, agent, setCatalogApproval, { required: false })))?.code,
    ).toBe("forbidden");
    await execute(t.app, owner, setCatalogApproval, { required: true });

    const r = await execute(t.app, agent, setProgramValuation, {
      slug: "chase_ur",
      typicalCpp: 1.6,
      sourceUrl: "https://thepointsguy.com/guide/monthly-valuations/",
      asOf: today,
    });
    expect(r.status).toBe("pending");
    const before = await execute(t.app, owner, listRewardPrograms, {});
    expect(before.programs.find((p) => p.slug === "chase_ur")?.edited).toBeUndefined();

    const denied = await errorOf(
      execute(t.app, agent, reviewCatalogChange, { changeId: r.changeId, decision: "approve" }),
    );
    expect(denied?.code).toBe("forbidden");
    // A person's own edits apply straight away.
    expect(
      (
        await execute(t.app, owner, updateCard, {
          slug: "citi_double_cash",
          patch: {},
          sourceUrl: "https://www.citi.com/credit-cards/citi-double-cash-credit-card",
          asOf: today,
        })
      ).status,
    ).toBe("applied");

    await execute(t.app, owner, reviewCatalogChange, { changeId: r.changeId, decision: "approve" });
    const after = await execute(t.app, owner, listRewardPrograms, {});
    const ur = after.programs.find((p) => p.slug === "chase_ur");
    expect(ur).toMatchObject({ typicalCpp: 1.6, edited: true });
    expect(ur?.defaultTypicalCpp).not.toBe(1.6);
    expect(ur?.usingCpp).toBe(1.6);

    // A proposal made against an older version of the entry can't be approved over a newer one.
    const p1 = await execute(t.app, agent, setProgramValuation, {
      slug: "chase_ur",
      typicalCpp: 1.7,
      sourceUrl: "https://thepointsguy.com/guide/monthly-valuations/",
      asOf: today,
    });
    const p2 = await execute(t.app, agent, setProgramValuation, {
      slug: "chase_ur",
      typicalCpp: 1.8,
      sourceUrl: "https://thepointsguy.com/guide/monthly-valuations/",
      asOf: today,
    });
    await execute(t.app, owner, reviewCatalogChange, {
      changeId: p2.changeId,
      decision: "approve",
    });
    expect(
      (
        await errorOf(
          execute(t.app, owner, reviewCatalogChange, {
            changeId: p1.changeId,
            decision: "approve",
          }),
        )
      )?.code,
    ).toBe("conflict");
    await execute(t.app, owner, reviewCatalogChange, { changeId: p1.changeId, decision: "reject" });
    await execute(t.app, owner, setCatalogApproval, { required: false });
  });

  it("adds a custom card that can be linked, exported and reset", async () => {
    await execute(t.app, agent, addCustomCard, {
      slug: "cu_rewards_visa",
      issuer: "Hometown Credit Union",
      name: "Rewards Visa",
      network: "visa",
      annualFee: 0,
      program: "cash_back",
      fxFeePercent: 0,
      base: 1.5,
      earn: [{ categories: ["groceries"], multiplier: 3 }],
      sourceUrl: "https://hometowncu.example/rewards-visa",
      asOf: today,
    });
    const dup = await errorOf(
      execute(t.app, agent, addCustomCard, {
        slug: "chase_sapphire_preferred",
        issuer: "X Bank",
        name: "Copy",
        network: "visa",
        annualFee: 0,
        program: "cash_back",
        fxFeePercent: 0,
        base: 1,
        earn: [],
        sourceUrl: SRC,
        asOf: today,
      }),
    );
    expect(dup?.code).toBe("conflict");
    await execute(t.app, owner, setWalletCard, { accountId: extra, cardSlug: "cu_rewards_visa" });
    const sheet = await execute(t.app, owner, getCheatSheet, {});
    expect(sheet.categories.find((c) => c.category === "groceries")?.card).toBe("Rewards Visa");

    const patch = await execute(t.app, owner, exportCatalogPatch, {});
    const added = patch.entries.find((e) => e.slug === "cu_rewards_visa");
    expect(added).toMatchObject({ action: "add", file: "cards/hometown-credit-union.json" });
    const ur = patch.entries.find((e) => e.slug === "chase_ur");
    expect(ur).toMatchObject({
      file: "programs.json",
      fields: expect.arrayContaining(["typicalCpp"]),
    });

    const stale = await execute(t.app, owner, getCatalogStaleness, {
      olderThanDays: 0,
      limit: 100,
    });
    expect(stale.entries[0]?.inWallet).toBe(true);

    await execute(t.app, owner, resetCatalogEntry, { entity: "card", slug: "cu_rewards_visa" });
    expect((await errorOf(execute(t.app, owner, getCard, { slug: "cu_rewards_visa" })))?.code).toBe(
      "not_found",
    );
  });

  it("lets the worker edit the catalog and nothing else", async () => {
    const w = workerPrincipal({ userId: owner.userId, householdId: owner.householdId });
    const r = await execute(t.app, w, updateCard, {
      slug: "chase_sapphire_preferred",
      patch: {},
      sourceUrl: SRC,
      asOf: today,
    });
    expect(r.status).toBe("applied");
    const denied = await errorOf(
      execute(t.app, w, setWalletCard, { accountId: sapphire, cardSlug: null }),
    );
    expect(denied?.code).toBe("forbidden");
    const { changes } = await execute(t.app, owner, listCatalogChanges, { limit: 1 });
    expect(changes[0]).toMatchObject({ via: "worker", by: "Built-in refresher" });
  });
});
