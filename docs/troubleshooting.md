# Troubleshooting

Start with the logs. Most problems say what's wrong there:

```bash
docker compose ps                     # is everything up and healthy?
docker compose logs -f web worker     # live logs
docker compose logs migrate           # the start-up step: migrations and the setup token
```

`/api/health` returns `{"ok":true}` when the web app can reach the database, and a 503 when it can't.

## Getting in

**The setup token has expired, or I lost it.** It lasts 24 hours. Print a new one with `docker compose run --rm migrate`. Once anyone has signed up, the setup page is gone for good and the command says "An owner account already exists".

**"That setup token is invalid or expired."** Copy the token again from `docker compose logs migrate`, without the surrounding text. If you've run `migrate` more than once, only the newest token works.

**"This passkey isn't registered here," or the browser offers no passkey.** Passkeys are bound to the exact hostname in `APP_URL`. If you open the app on a different name (an IP address, `localhost`, another domain), the browser won't offer it. Browsers built into other apps often can't use passkeys at all; use a regular browser. Open the address in `APP_URL`. If you changed `APP_URL` after signing up, change it back, or sign in with a recovery code and register a new passkey for the new name.

**"Sign-in timed out. Please try again."** The sign-in challenge lasts five minutes. Reload the page and try again.

**"Too many attempts. Try again later."** Sign-in, recovery and setup are rate-limited per address. Wait 15 minutes (an hour for repeated recovery attempts on one account).

**I lost my passkey.** On the sign-in page choose **Lost your passkey? Use a recovery code**, then register a new passkey. If the recovery codes are gone too, see [Locked out](self-hosting.md#locked-out).

**The page says "Forbidden" and nothing else.** That's the access gate, which runs before the app's own sign-in.

- With `ACCESS_MODE=tailscale`, your tailnet login isn't in `TAILSCALE_ALLOWED_USERS`. Add it (comma-separated, exactly as Tailscale shows it), then run `docker compose up -d web`.
- With `ACCESS_MODE=cloudflare`, the request didn't carry a valid Access token. Check `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`, and that the Access application covers the hostname.

**The web container won't start: "ACCESS_MODE must be 'tailscale' or 'cloudflare' in production."** Set `ACCESS_MODE` in `.env`. The app refuses to run without a network gate in front of it. The override in the message exists for the public demo; don't use it for real data.

## Bank connections

**A connection has said "Linking…" for a long time.** The worker does the linking. Check that it's running (`docker compose ps worker`) and read `docker compose logs worker`. If the worker was restarting when you linked, the scheduler picks the connection up within 15 minutes.

**"Reconnect needed."** The bank or aggregator revoked access, or a password or MFA setting changed at the bank. Remove the connection under **Settings → Connections** and link it again. Your accounts and history are kept.

**A connection shows an error after every sync.** The message is shown under the connection in **Settings → Connections**; check `docker compose logs worker` for the full error. Temporary aggregator problems are retried; an error that stays usually needs the connection relinked.

**Transactions appear twice.** Re-importing the same file is safe: rows already present are skipped. A file imported into an account that is also synced from a bank skips same-day, same-amount rows that came from the bank, but a file and a sync can still disagree on dates. Delete the imported copies from the transaction editor, or remove the whole import under **Transactions → Import → Recent imports**.

**I imported into the wrong account.** **Transactions → Import → Recent imports → Remove this import.**

**A payment between my own accounts counts as spending.** Transfers are recognized when the same amount leaves one account and arrives in another within three days, and either the money went to a card or loan, or a description says transfer or payment. Anything else needs a category by hand: open it and choose **Transfer**. Add a rule so the next one is handled for you.

## Dates and schedules

**"Today," the budget month or the weekly digest is a day off.** Set `TZ` in `.env` to your time zone (for example `TZ=America/Chicago`), then run `docker compose up -d`. Without it the app keeps time in UTC.

## Notifications

**"That address is on a private network."** The ntfy URL resolves to a LAN, tailnet or loopback address, which is refused by default. If you run ntfy yourself on your network, set `NTFY_ALLOW_PRIVATE=1` in `.env` and run `docker compose up -d`.

**No notifications arrive.** Use **Send a test** under **Settings → Notifications**. Alerts are sent after a sync finds something new, so a quiet account sends nothing. Each alert is sent once.

## AI features

**"AI isn't configured on this server."** Set `ANTHROPIC_API_KEY` in `.env` (or as a Docker secret, see [self-hosting](self-hosting.md#keep-api-keys-out-of-the-environment)) and run `docker compose up -d`. Then the household owner turns it on under **Settings → AI**.

**"This household has used its AI tokens for the month."** The owner can raise the monthly limit under **Settings → AI**. It resets on the 1st.

**"Too many AI requests this hour."** A separate per-household limit on interactive requests. Wait and try again.

## Containers

**The worker shows as unhealthy.** Its health check looks for a heartbeat it writes every 30 seconds. Read `docker compose logs worker`. If it stops at start-up with "keyring self-test failed", `secrets/worker_keys` is damaged; restore it from your backup of `./secrets`. If it starts but every new link fails to open its credentials, `secrets/worker_keys` and `secrets/worker_public_key` come from different runs of `pnpm keys:generate`: restore the matching pair.

**`migrate` fails.** Its log names the migration and the database error. Migrations run in a transaction, so a failed one leaves the database as it was. Don't edit the database by hand; open an issue with the log.

**After restoring a backup, bank connections fail.** The database was restored but `secrets/worker_keys` wasn't. Restore the keys too, or relink each connection.

## Still stuck?

Search the [issues](https://github.com/nathanielnoyd/money-manager/issues), or open one with the relevant log lines. Remove amounts, account names and anything else personal first. For anything that looks like a security problem, follow [SECURITY.md](../SECURITY.md) instead of opening a public issue.
