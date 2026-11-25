# Self-hosting

Money Manager runs as a Docker Compose stack: `db` (Postgres), `migrate` (runs once at start-up), `web`, `worker`, an optional `backup`, and **one** access container, `tailscale` or `cloudflared`. No container publishes a port on the host. The access container is the only way in.

## 1. Prepare a host

- Any Linux machine with Docker Engine and the Compose plugin: a home server, a mini PC or a small cloud VM. Images are built for amd64 and arm64.
- **Turn on full-disk encryption.**
- Allow no inbound traffic. Tailscale and Cloudflare Tunnel only make outbound connections.
- Install git, plus Node 24 and pnpm for generating secrets. You can generate secrets on another machine and copy the folder across.

## 2. Generate secrets

```bash
pnpm install --frozen-lockfile
pnpm keys:generate          # writes ./secrets (mode 0700)
```

| File                      | Used by     | Purpose                                      |
| ------------------------- | ----------- | -------------------------------------------- |
| `postgres_admin_password` | db, migrate | Database admin, used only for migrations     |
| `app_db_password`         | web, worker | App role: not a superuser, cannot bypass RLS |
| `auth_encryption_key`     | web         | Encrypts TOTP seeds                          |
| `worker_public_key`       | web         | Seals bank tokens; cannot open them          |
| `worker_keys`             | worker      | Opens bank tokens                            |
| `restic_password`         | backup      | Encrypts backups                             |

**Back up `./secrets` offline**, separately from database backups. Losing `worker_keys` means re-linking every bank. Losing `restic_password` means backups can't be restored.

## 3. Choose how you reach it

Pick one. The app refuses to start in production without one of these in front of it, and it verifies the access layer itself on every request.

### Option A: Tailscale (no domain needed)

1. In the Tailscale admin console, enable **MagicDNS** and **HTTPS certificates**.
2. Create a pre-approved, tagged auth key.
3. In `.env`:

   ```ini
   APP_URL=https://money.<your-tailnet>.ts.net
   ACCESS_MODE=tailscale
   TS_AUTHKEY=tskey-auth-…
   TS_HOSTNAME=money
   TAILSCALE_ALLOWED_USERS=you@example.com,partner@example.com   # recommended allow-list
   COMPOSE_PROFILES=tailscale,backup
   ```

4. Restrict who can reach the tag with Tailscale ACLs.

Every device that opens the app must be on your tailnet.

### Option B: Cloudflare Tunnel with Access (needs a domain on Cloudflare)

1. In Zero Trust, create a tunnel and copy its token. Add a public hostname, such as `money.example.com`, pointing to `http://web:3000`.
2. Create a **self-hosted Access application** for that hostname with a policy that allows only your email addresses. Copy its **Application Audience (AUD) tag**.
3. In `.env`:

   ```ini
   APP_URL=https://money.example.com
   ACCESS_MODE=cloudflare
   CLOUDFLARE_TUNNEL_TOKEN=…
   CF_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com
   CF_ACCESS_AUD=…
   COMPOSE_PROFILES=cloudflare,backup
   ```

The app verifies Cloudflare's signed Access token on every request, so a request that bypasses the tunnel is rejected.

## 4. Start and create the owner

```bash
cp .env.example .env     # then fill in the values above and TZ, e.g. TZ=America/Chicago
docker compose up -d --build
docker compose logs migrate
```

The `migrate` log shows a one-time setup token, valid for 24 hours. Open `APP_URL`, enter it, and create your passkey. **Save the recovery codes** in a password manager. Setup is disabled permanently once an owner exists. If the token expires, `docker compose run --rm migrate` prints a new one.

Passkeys are bound to the hostname in `APP_URL`. Always open the app at that address.

`TZ` sets when "today" and each budget month begin, and the clock for scheduled jobs. It applies to the whole server.

### Locked out

Lost your passkey: sign in with a recovery code and register a new passkey. Lost the codes too: issue new ones from the server.

```bash
docker compose run --rm migrate node dist/recover.mjs                   # the only owner
docker compose run --rm migrate node dist/recover.mjs you@example.com   # a specific person
```

This prints ten new codes and cancels the old ones. Add `--remove-totp` if the authenticator device is also gone.

## 5. Connect your banks

Bank credentials are sealed to the worker's public key the moment you submit them. The web app can store them but never read them.

- **SimpleFIN.** Settings → Connections → **Connect with SimpleFIN**. Create a SimpleFIN Bridge account, connect your institutions there, and paste the setup token.
- **Plaid.** Add your keys to `.env`. A **Connect with Plaid** button appears under Settings → Connections.

  ```ini
  PLAID_CLIENT_ID=…
  PLAID_SECRET=…
  PLAID_ENV=production
  PLAID_REDIRECT_URI=https://<APP_URL host>/settings/connections/oauth   # needed for OAuth banks
  ```

- **Teller.** Set `TELLER_APPLICATION_ID` and `TELLER_ENV`. Outside sandbox, save the client certificate as `secrets/teller_cert.pem` and `secrets/teller_key.pem` and mount them into the worker only:

  ```yaml
  # compose.override.yml
  services:
    worker:
      environment:
        TELLER_CERT_FILE: /run/secrets/teller_cert
        TELLER_KEY_FILE: /run/secrets/teller_key
      secrets: [app_db_password, worker_keys, teller_cert, teller_key]
  secrets:
    teller_cert: { file: ./secrets/teller_cert.pem }
    teller_key: { file: ./secrets/teller_key.pem }
  ```

- **Files.** Transactions → **Import** accepts CSV, OFX, QFX and QBO. Re-importing an overlapping file never creates duplicates.

Plaid Link and Teller Connect load the provider's script in the browser when you click **Connect**. That is the only third-party script the app ever loads; see [security.md](security.md#web-hardening). Use SimpleFIN or file imports if you'd rather not extend that trust.

Connections sync every 6 hours by default (`SYNC_INTERVAL_HOURS`), or on demand with **Sync now**.

## 6. Optional features

### Notifications

Settings → Notifications sends alerts through [ntfy](https://ntfy.sh).

- Use a long random topic, or protect it with an access token. Anyone who knows a public topic can read it.
- Turn off **Include amounts and balances** to send alerts without figures.
- A self-hosted ntfy server on your LAN or tailnet needs `NTFY_ALLOW_PRIVATE=1`. Otherwise URLs that resolve to private addresses are refused.

### AI

Set `ANTHROPIC_API_KEY` (optionally `AI_MODEL`). Nothing is sent until a household owner turns AI on under **Settings → AI**, which shows exactly what each feature shares. See [security.md](security.md#ai-optional) for what the AI can reach.

### Agents

Create a token under **Settings → Agents** and follow [agents.md](agents.md).

### Keep API keys out of the environment

Keys in `.env` are visible to anyone who can run `docker inspect`. Every secret also accepts a `_FILE` variant. Save the key under `secrets/` and mount it:

```yaml
# compose.override.yml
services:
  web:
    environment:
      ANTHROPIC_API_KEY_FILE: /run/secrets/anthropic_api_key
      PLAID_SECRET_FILE: /run/secrets/plaid_secret
    secrets:
      [app_db_password, auth_encryption_key, worker_public_key, anthropic_api_key, plaid_secret]
  worker:
    environment:
      ANTHROPIC_API_KEY_FILE: /run/secrets/anthropic_api_key
      PLAID_SECRET_FILE: /run/secrets/plaid_secret
    secrets: [app_db_password, worker_keys, anthropic_api_key, plaid_secret]
secrets:
  anthropic_api_key: { file: ./secrets/anthropic_api_key }
  plaid_secret: { file: ./secrets/plaid_secret }
```

## 7. Household members

Settings → Household → **Invite someone** creates a single-use link, valid for 7 days. The invitee creates their own passkey.

| Role   | Can                                                                   |
| ------ | --------------------------------------------------------------------- |
| Owner  | Everything, including members, bank connections and security settings |
| Member | Edit transactions, budgets, rules, categories and goals               |
| Viewer | Read only                                                             |

Removing a member signs them out immediately.

## 8. Backups

With `backup` in `COMPOSE_PROFILES`, the `backup` container dumps the database nightly (`BACKUP_TIME`) into an encrypted [restic](https://restic.net) repository, keeping 7 daily, 5 weekly and 12 monthly snapshots.

The default repository is a local volume. **Point it off-site** with any S3-compatible store:

```ini
RESTIC_REPOSITORY=s3:https://<endpoint>/money-manager
BACKUP_S3_ACCESS_KEY_ID=…
BACKUP_S3_SECRET_ACCESS_KEY=…
```

| Task              | Command                                    |
| ----------------- | ------------------------------------------ |
| Back up now       | `docker compose run --rm backup now`       |
| List snapshots    | `docker compose run --rm backup snapshots` |
| Verify repository | `docker compose run --rm backup check`     |

**Restore:**

1. `docker compose stop web worker`
2. `docker compose run --rm backup restore latest` (or a snapshot id)
3. `docker compose up -d`

The restore loads into a fresh database and swaps it in only if loading succeeds. The previous database is kept as `money_manager_before_restore_<timestamp>`.

On a new machine, copy `secrets/` and `.env` first, run `docker compose up -d db migrate`, then steps 2 and 3.

## 9. Day to day

| Task    | Command                                                   |
| ------- | --------------------------------------------------------- |
| Status  | `docker compose ps`                                       |
| Logs    | `docker compose logs -f web worker`                       |
| Upgrade | See [upgrading.md](upgrading.md)                          |
| Stop    | `docker compose down` (data stays in the `pgdata` volume) |

## Hardening checklist

- [ ] Full-disk encryption on the host
- [ ] No inbound firewall rules
- [ ] Tailscale ACLs and `TAILSCALE_ALLOWED_USERS`, or a Cloudflare Access policy, limited to people you trust
- [ ] `./secrets` backed up offline, separate from database backups, directory mode `0700`
- [ ] Off-site backups configured and a restore tested
- [ ] Recovery codes stored in a password manager
- [ ] Third-party API keys supplied as files, not in `.env`
- [ ] Automatic OS security updates enabled
