# Card and points catalog

Data for the US credit cards and points programs Money Manager ships with. It comes from [Open Credit Card Benefits](https://github.com/nathanielnoyd/open-credit-card-benefits) (OCCB), an open dataset of card terms with versioned history and sources.

- `cards/<issuer>.json`: cards with fees, earn rules, caps, sources and notes on anything OCCB models that this app can't.
- `programs.json`: points programs with a floor and a typical cents-per-point value, each citing its source and date.
- `SOURCE.json`: the OCCB commit and as-of date the files were generated from, and counts.

**These files are generated. Don't edit them by hand.** Regenerate them from an OCCB checkout:

```bash
pnpm --filter @mm/rewards catalog:import -- --from <path to an OCCB checkout> [--as-of YYYY-MM-DD]
```

The importer ([`../src/cli/import-occb.ts`](../src/cli/import-occb.ts)) takes each card's terms for someone applying on the as-of date, converts them to the format in [`../src/schema.ts`](../src/schema.ts), and prints what it dropped or approximated. See [`.claude/skills/import-card-catalog`](../../../.claude/skills/import-card-catalog/SKILL.md) for the full steps. If a value is wrong, fix it in OCCB and re-import.

Households keep their own copy current without waiting for a release: their agent checks a card against the issuer's pages and records corrections through the catalog operations (`update_card`, `add_custom_card`, `get_catalog_staleness`), with history, review and undo.

## License

The data in this folder comes from Open Credit Card Benefits and is licensed under [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/). Attribution: "Open Credit Card Benefits contributors", [github.com/nathanielnoyd/open-credit-card-benefits](https://github.com/nathanielnoyd/open-credit-card-benefits). It has been converted to Money Manager's format, which drops or approximates some terms (each card's `notes` say which). Card names and trademarks belong to their issuers. The code in the rest of this repository remains under AGPL-3.0-or-later.
