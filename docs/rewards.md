# Card rewards

Money Manager calculates the points, miles and cash back each credit card purchase earns, values them in dollars, and shows what the best card in your wallet would have earned instead.

## Set up your wallet

1. **Rewards → Wallet.** Each credit card account gets a suggested card, matched from its name. Confirm it or pick another from the catalog, then **Link card**.
2. Optionally enter the date you **opened** the card (for caps that reset on your card anniversary) and tick **Activated** each quarter for rotating-category cards.
3. **Rewards → Settings → How your categories earn.** Each of your spending categories maps to a reward category such as dining, groceries or airfare. Defaults are set; change any of them.
4. **Rewards → Settings → Point values.** Value points at the **typical** published valuation (default), the **floor** you can always redeem for, or your own cents per point.

Transactions then show what they earned, for example `+3x · 41¢`. The chip turns amber when another card in your wallet would have earned noticeably more.

## What you get

- **Overview:** earnings this month and year to date; **which card to use** for each category; **left on the table** over the last 90 days; sign-up bonus progress.
- **Wallet:** per card, what it earned, what it adds over your other cards, the credits you use, its annual fee and the net. Cards with a negative net are marked **review**. Track sign-up bonuses and points balances here.
- **Explore cards:** replays your last 12 months of card spending with each catalog card added, and ranks them by extra rewards minus the annual fee. This is arithmetic on your data, not financial advice; it ignores sign-up bonuses, credits and approval odds.
- **Reminders** (Settings → Notifications → Card rewards): activate rotating categories, a cap almost reached, a sign-up bonus deadline, an annual fee coming due, and stale catalog data for a card you hold.

## How a purchase is counted

- **Reward category:** a per-transaction override, then a per-merchant setting, then your category map, then the bank's category, then "everything else".
- **Rate:** the best matching rate on the card. Caps are tracked per period (month, quarter, calendar year or cardmember year); beyond a cap, the after-cap rate applies.
- **Refunds** take back the points the purchase earned.
- **Not counted:** transfers, card payments, income, excluded and pending transactions.

Everything is computed when you look, so changes to categories, rules or the wallet apply immediately.

## The card catalog

The catalog shipped with each release is generated from **[Open Credit Card Benefits](https://github.com/nathanielnoyd/open-credit-card-benefits)**, an open dataset of US credit card earn rates, fees and points currencies with a source on every record (CC BY 4.0). The snapshot it was built from is recorded in [`packages/rewards/catalog/SOURCE.json`](../packages/rewards/catalog/SOURCE.json).

Treat it as a starting point. Card terms change several times a year, and the dataset is compiled from public sources. Check anything important with the issuer.

### Simplifications

Some issuer rules can't be expressed by the earning engine. Where that happens, the card's `notes` say what was left out. Common cases:

- Rates that depend on things the app can't see, such as the payment method, a linked partner account, or the time of day.
- Different portal rates by booking type; the card's top portal rate is used.
- Stacked bonuses; the higher rate applies.
- Statement cycles, which are treated as calendar months.

## Keep the catalog current with your agent

Your catalog is the shipped snapshot plus your household's own edits. Edits always carry a source link and a "checked on" date, apply only to your household, survive app upgrades, and can be undone under **Rewards → Settings → Card catalog**.

1. Create an agent token with **Read** and **Edit card catalog** ([agents.md](agents.md)).
2. Ask your agent to refresh the catalog, or run the built-in `refresh_rewards_catalog` prompt. The agent:
   - calls `get_catalog_staleness` for the cards and programs that need checking,
   - checks each against the issuer's own page,
   - records changes with `update_card` and `set_program_valuation`, or records that it checked and nothing changed,
   - adds cards the catalog lacks, such as a credit union card, with `add_custom_card`.
3. Review what changed under **Rewards → Settings → Card catalog**.

To run this on a schedule, see [agents.md](agents.md#keep-the-card-catalog-current). If AI is enabled on the server, the owner can instead turn on **Keep my cards' rates and fees up to date** under **Settings → AI**, a built-in monthly check of the cards in your wallet.

**Approval.** Agent edits apply immediately by default, since every edit can be undone. The owner can turn on **Require my approval for changes made by agents and the refresher** so edits wait for a person to approve them. Approval is only available in the app, never to an agent.

**Limits.** Every edit is validated: multipliers 0–25x, point values 0.1–5¢ with typical at or above floor, https sources only, no future dates. A card's identifier never changes.

**Sharing fixes.** A correction that would help everyone belongs in Open Credit Card Benefits. Open an issue or pull request there, and the next release picks it up. `export_catalog_patch` lists your household's edits with their sources to make that easy.

## Updating the shipped catalog (maintainers)

The shipped catalog is generated, not edited by hand:

```bash
pnpm --filter @mm/rewards catalog:import -- --from <path to an open-credit-card-benefits checkout>
```

See [`packages/rewards/catalog/README.md`](../packages/rewards/catalog/README.md).
