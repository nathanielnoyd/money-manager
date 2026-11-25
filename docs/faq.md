# FAQ

**What does it cost?**
The software is free. You need a machine to run it on. Bank-data providers (SimpleFIN, Plaid, Teller) may charge for access; importing files from your bank is free.

**Which banks and countries are supported?**
The US. Connectors reach US institutions through SimpleFIN, Plaid or Teller, and amounts are shown in US dollars. If your bank isn't covered, import CSV or OFX files from its website.

**Can I use other currencies?**
Accounts in other currencies can be imported, but totals such as net worth don't convert them.

**Is there a phone app?**
No. The web app works in a phone browser through the same Tailscale or Cloudflare access.

**Can I switch from another budgeting app?**
Export transactions as CSV and import them one account at a time. Categories from the other app aren't carried over; rules and AI categorization can fill them in.

**Where does my data go?**
It stays in your Postgres database. The app contacts other services only when you set them up: your bank-data provider (from the worker), Anthropic (only if you add a key and the owner turns AI on), your ntfy server, and your backup destination. There's no telemetry, and no third-party script in the browser except Plaid's or Teller's linking widget while you link a bank through them.

**Does it store my bank password?**
No. You sign in to your bank through the provider, and the app receives a read-only token, encrypted so that only the background worker can read it.

**Can I put it on the public internet?**
Not without a gate. The app refuses to start in production unless `ACCESS_MODE` is `tailscale` or `cloudflare`, and no container publishes a port.

**Why passkeys and no password?**
Passkeys can't be phished or reused, and there's no password database to leak. Register more than one device, and keep the recovery codes.

**My browser won't offer my passkey.**
Open the app at the exact address in `APP_URL`. Browsers built into other apps often can't use passkeys; use a regular browser such as Safari, Chrome, Firefox or Edge.

**What does the AI see?**
Nothing until the household owner turns it on. Then: categorization sends a transaction's description and amount; Ask calls read-only tools that return totals or at most 25 rows; the weekly digest sends a summary the app already calculated. Account numbers and credentials are never sent.

**Can an AI agent change my data?**
Only with a token you create, with the permissions you choose, and never beyond your own role. Agents can't link banks, manage members, change security or AI settings, export, or delete accounts. See [agents.md](agents.md).

**Where do the credit card rates come from?**
From [Open Credit Card Benefits](https://github.com/nathanielnoyd/open-credit-card-benefits), an open dataset. Your agent can keep your copy current. See [rewards.md](rewards.md).

**How often does it sync?**
About every 6 hours (`SYNC_INTERVAL_HOURS`). **Sync now** under Settings → Connections runs one immediately.

**How do I get my data out?**
**Settings → Export** downloads transactions as CSV or the whole household as JSON. You can also back up and restore the full database ([self-hosting.md](self-hosting.md#8-backups)).

**How do I update?**
Back up, then follow [upgrading.md](upgrading.md).

**Something's wrong.**
See [troubleshooting.md](troubleshooting.md).
