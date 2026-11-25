# Changelog

Notable changes to Money Manager. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Before 1.0, a minor version may include breaking changes; they are listed under **Upgrade notes**.

## [Unreleased]

## [0.1.0] - Unreleased

First public release.

- **Self-hosting:** a Docker Compose stack that publishes no ports, reached through Tailscale or Cloudflare Tunnel with Access. Hardened containers, multi-arch images, encrypted off-site backups.
- **Security:** passkey sign-in with recovery codes and optional TOTP; Postgres row-level security per household; bank credentials only the worker can decrypt; strict CSP; audit log.
- **Bank data:** SimpleFIN, Plaid and Teller with your own keys; CSV, OFX, QFX and QBO import.
- **Money management:** transactions with rules, splits and transfer detection; budgets; cash flow; recurring bills; investments; goals; net worth.
- **Card rewards:** earnings per purchase, best card per category, card value and recommendations, with a catalog generated from Open Credit Card Benefits that your agent keeps current.
- **Household:** owner, member and viewer roles.
- **Alerts:** ntfy push notifications.
- **Agents (MCP):** scoped, expiring, revocable tokens; never admin.
- **AI (optional):** questions in plain English, suggested categories and a weekly digest, using your own Anthropic key and off until the owner opts in.
- **Export:** transactions as CSV, or the whole household as JSON.

[Unreleased]: https://github.com/nathanielnoyd/money-manager/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nathanielnoyd/money-manager/releases/tag/v0.1.0
