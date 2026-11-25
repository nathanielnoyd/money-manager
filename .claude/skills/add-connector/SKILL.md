---

name: add-connector
description: Add a bank data provider (aggregator) to Money Manager behind the Connector interface. Use when asked to support a new bank-data source.
---

# Add a connector

1. Read `packages/connectors/src/types.ts` (`Connector`, `NormalizedAccount`, `NormalizedTransaction`, `SyncResult`) and one existing connector, such as `simplefin.ts` (the simplest) or `plaid.ts` (cursor-based).
2. Create `packages/connectors/src/<provider>.ts`:
   - `completeLink(input)` exchanges what the user pasted or approved for a long-lived secret.
   - `sync({ secret, cursor })` returns normalized accounts and transactions. Amounts are minor units, positive means money in. Balances use the asset perspective, where a negative balance is money owed.
   - Talk only to the provider's fixed API hosts, with `redirect: "error"` and timeouts. Check any URL the user supplies with `checkOutboundUrl` from `net.ts` (see how `simplefin.ts` limits hosts).
3. Export a `create<Provider>Connector(options)` factory from `packages/connectors/src/index.ts`. Add the provider id to `ProviderId` and to the `connection_provider` enum in `packages/db/src/schema.ts` (with a migration). Construct the connector in `apps/worker/src/jobs/sync.ts` next to the others, keeping the worker running when it's misconfigured, as Teller does.
4. The web tier may only **seal** the secret to the worker's public key. The worker decrypts it. Never log secrets.
5. Add a linking UI under `apps/web/src/app/(app)/settings/connections/`.
6. Write tests with recorded or fake responses (see `plaid.test.ts`). Never call live APIs in tests.
7. Document setup in `docs/self-hosting.md` → "Connect your banks".
