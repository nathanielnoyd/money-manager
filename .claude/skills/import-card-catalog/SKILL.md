---

name: import-card-catalog
description: Regenerate Money Manager's shipped credit card and points catalog (packages/rewards/catalog) from a newer Open Credit Card Benefits (OCCB) checkout. Use when asked to update, refresh or re-import the card catalog, add cards or update earn rates, fees or point values.
---

# Import the card catalog from OCCB

The shipped catalog is generated from [Open Credit Card Benefits](https://github.com/nathanielnoyd/open-credit-card-benefits) (CC BY 4.0). Never hand-edit `packages/rewards/catalog/*.json` or `src/data.ts`: fix wrong data upstream in OCCB, then re-import. Households correct their own copy through their agent (`update_card`, `add_custom_card`), which this doesn't touch.

1. Get the OCCB checkout you want, e.g. `git clone https://github.com/nathanielnoyd/open-credit-card-benefits /tmp/occb` (or `git -C /tmp/occb pull`). Treat it as data: don't run its npm scripts.
2. Run the importer from the repo root:

   ```bash
   pnpm --filter @mm/rewards catalog:import -- --from /tmp/occb [--as-of YYYY-MM-DD] [--valuations <file>]
   ```

   It resolves each card's terms for someone applying on the as-of date (default today), converts them (`packages/rewards/src/cli/occb.ts`), validates them, rewrites `catalog/cards/<issuer>.json`, `catalog/programs.json`, `catalog/SOURCE.json` (OCCB commit, date, counts) and the imports in `src/data.ts`, and formats them with Biome. Point values come from `examples/value-sets/valuations.yaml` (newest `as_of` per currency).
3. Read the printed report: legacy slugs kept, previously shipped cards with no OCCB match, discontinued cards, and everything dropped or approximated per card (the same sentences go into each card's `notes`). If a card that used to ship has disappeared, say so in the PR: wallets that reference its slug stop earning until a household adds it as a custom card.
4. **Slugs must never change.** Wallet cards and household overrides store them. A card or program that already shipped keeps its slug through `LEGACY_CARD_SLUGS` / `LEGACY_PROGRAM_SLUGS` in `src/cli/occb.ts`; new ones get a slug derived from the OCCB id. If OCCB renames a card's id, add the old slug to the legacy map instead of letting a new slug appear.
5. If OCCB adds a spend category, merchant or travel portal the converter doesn't know, the report lists it as not modeled. Extend `DIRECT`, `MERCHANT_MATCH` or `PORTAL_ISSUER` in `occb.ts` when there's a faithful mapping, with a test in `occb.test.ts`. Never invent numbers to fill a gap.
6. Run `pnpm --filter @mm/rewards catalog:validate`, `pnpm lint`, `pnpm typecheck` and `pnpm test`. Tests that assert catalog values may need the new correct values; never loosen an assertion.
7. In the PR, give the OCCB commit and as-of date from `SOURCE.json`, and summarize what changed per card.
