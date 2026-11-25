# Public demo

`DEMO_MODE=1` turns an instance into a public, read-only showcase:

- The login page offers **Explore the demo** instead of passkey sign-in. Each visitor gets a session as a **viewer** in a generated "Demo Household", with a year of transactions, budgets, goals, investments and recurring bills.
- Everything is read-only through the normal role checks. Account features (passkeys, TOTP, recovery codes), setup, invites and recovery are disabled too, so nobody can take over the shared demo account.
- The worker rebuilds the demo household every night (`DEMO_RESET_CRON`, default 04:00), so dates stay current and any visitor's view is clean.
- Bank connections, notifications and AI aren't configured on a demo, so nothing leaves the server.

## Safety

Demo mode is meant for a **dedicated database**. The worker refuses to start in demo mode if the database contains any household other than the demo one. Turning it on by mistake on a real instance stops the worker instead of touching your data.

## Run it

```bash
pnpm keys:generate --out secrets-demo
printf 'APP_URL=https://demo.example.com\nSOURCE_URL=https://github.com/nathanielnoyd/money-manager\n' > .env.demo
docker compose -f compose.demo.yml --env-file .env.demo up -d --build
```

The web container listens on `127.0.0.1:3000`. Put a TLS-terminating reverse proxy (Caddy, nginx) in front of it, or a Cloudflare Tunnel **public hostname without an Access policy**. A demo is meant to be public, so there's no access gate (`ACCESS_MODE=none` with `ALLOW_NO_ACCESS_GATE=1`, set in `compose.demo.yml`).

A demo needs well under 1 GB of RAM.
