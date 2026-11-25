import { describe, expect, it } from "vitest";
import { CATALOG } from "./data";
import { applyOverrides, changedFields, resolveCard, resolveProgram } from "./overrides";

const programs = new Set(CATALOG.programs.map((p) => p.slug));
const gold = CATALOG.cards.find((c) => c.slug === "amex_gold");
const mr = CATALOG.programs.find((p) => p.slug === "amex_mr");

describe("catalog overrides", () => {
  it("patches top-level card fields and keeps the rest from the release", () => {
    if (!gold) throw new Error("amex_gold missing from catalog");
    const r = resolveCard(
      gold,
      { slug: "amex_gold", patch: { annualFee: 395 }, custom: false },
      programs,
    );
    expect(r.ok && r.value.annualFee).toBe(395);
    expect(r.ok && r.value.earn).toEqual(gold.earn);
  });

  it("ignores fields an override may not set, and never changes the slug", () => {
    if (!gold) throw new Error("amex_gold missing");
    const r = resolveCard(
      gold,
      { slug: "amex_gold", patch: { slug: "other", evil: true }, custom: false },
      programs,
    );
    expect(r.ok && r.value.slug).toBe("amex_gold");
    expect(r.ok && "evil" in r.value).toBe(false);
  });

  it("rejects values outside the schema's bounds", () => {
    const r = resolveCard(
      gold,
      {
        slug: "amex_gold",
        patch: { earn: [{ categories: ["dining"], multiplier: 40 }] },
        custom: false,
      },
      programs,
    );
    expect(r.ok).toBe(false);
    expect(resolveProgram(mr, { slug: "amex_mr", patch: { typicalCpp: 9 } }).ok).toBe(false);
    // typical must stay at or above floor
    expect(resolveProgram(mr, { slug: "amex_mr", patch: { typicalCpp: 0.1 } }).ok).toBe(false);
  });

  it("needs a known program and a whole card for a custom card", () => {
    const card = {
      issuer: "Credit Union",
      name: "Rewards Visa",
      network: "visa",
      annualFee: 0,
      program: "cash_back",
      fxFeePercent: 0,
      base: 1.5,
      earn: [{ categories: ["groceries"], multiplier: 3 }],
      sources: [{ url: "https://example.org/card" }],
      verifiedAt: "2026-11-01",
    };
    expect(
      resolveCard(undefined, { slug: "cu_rewards", patch: card, custom: true }, programs).ok,
    ).toBe(true);
    expect(
      resolveCard(undefined, { slug: "cu_rewards", patch: card, custom: false }, programs).ok,
    ).toBe(false);
    const bad = resolveCard(
      undefined,
      { slug: "cu_rewards", patch: { ...card, program: "nope" }, custom: true },
      programs,
    );
    expect(bad.ok ? "" : bad.error).toContain("unknown program");
  });

  it("applies a household's overrides and skips the ones that no longer fit", () => {
    const { catalog, skipped } = applyOverrides(CATALOG, [
      { entity: "program", slug: "amex_mr", patch: { typicalCpp: 1.8 }, custom: false },
      { entity: "card", slug: "amex_gold", patch: { annualFee: 395 }, custom: false },
      { entity: "card", slug: "gone_card", patch: { annualFee: 1 }, custom: false },
      { entity: "program", slug: "gone_program", patch: { typicalCpp: 1 }, custom: false },
    ]);
    expect(catalog.programs.find((p) => p.slug === "amex_mr")?.typicalCpp).toBe(1.8);
    expect(catalog.cards.find((c) => c.slug === "amex_gold")?.annualFee).toBe(395);
    expect(catalog.cards).toHaveLength(CATALOG.cards.length);
    expect(skipped.map((s) => s.slug).sort()).toEqual(["gone_card", "gone_program"]);
    // the shipped catalog is untouched
    expect(CATALOG.cards.find((c) => c.slug === "amex_gold")?.annualFee).toBe(gold?.annualFee);
  });

  it("lists changed fields", () => {
    expect(changedFields({ a: 1, b: [1] }, { a: 1, b: [2], c: 3 })).toEqual(["b", "c"]);
    expect(changedFields(undefined, { a: 1 })).toEqual(["a"]);
  });
});
