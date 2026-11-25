# Contributing to Money Manager

Money Manager holds people's complete financial lives, so contributions are held to a high bar for **security, correctness and privacy**. This guide covers setup and what reviewers check.

## Ground rules

- Be kind and constructive. See the [Code of Conduct](CODE_OF_CONDUCT.md).
- **Security issues go to private reporting, never public issues.** See [SECURITY.md](SECURITY.md).
- Never paste real financial data, account numbers, tokens or API keys into issues, PRs, tests or screenshots. Use `pnpm db:seed` demo data.
- Card catalog corrections (earn rates, fees, point values) go to [Open Credit Card Benefits](https://github.com/nathanielnoyd/open-credit-card-benefits), which the shipped catalog is generated from.

## Development setup

Requirements: Node 24+, pnpm 12+, Docker.

```bash
pnpm install
pnpm dev:setup                              # writes .env.development with fresh dev keys
docker compose -f compose.dev.yml up -d     # Postgres 18 on 127.0.0.1:5432
pnpm db:migrate                             # prints a first-run setup token
pnpm dev                                    # web on http://localhost:3000 (+ worker)
pnpm db:seed                                # after setup: a year of realistic demo data
```

Passkeys work on `localhost` without HTTPS. Chrome's DevTools → WebAuthn panel can add a virtual authenticator if your machine has no Touch ID / Windows Hello.

## Before you open a PR

```bash
pnpm lint          # Biome (formatting + lint); `pnpm format` fixes most things
pnpm typecheck
pnpm test          # unit + Postgres integration tests (needs compose.dev.yml running)
pnpm --filter @mm/web build && pnpm --filter @mm/web test:e2e
```

`pnpm test:coverage` runs the tests with a coverage summary per package. Without Postgres the integration tests are skipped locally; in CI they must run.

CI runs the same checks, plus CodeQL, Gitleaks, a dependency audit, Trivy, dependency review and a sign-off check on every commit.

## How the code is organized

[docs/architecture.md](docs/architecture.md) has diagrams of the containers, the packages and how a request, a sync and an agent call move through them.

| Path                  | What lives there                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`            | Next.js app: UI, auth, server actions                                                                                     |
| `apps/worker`         | Background jobs: bank sync, alerts, weekly digest; also the `migrate` entrypoint                                          |
| `packages/core`       | Pure domain logic (money, budgets, rules, parsers, recurring detection). No I/O, easy to test                             |
| `packages/db`         | Drizzle schema, migrations, RLS policies, ingest engine, seed data                                                        |
| `packages/crypto`     | Sealed boxes, secretbox, TOTP, recovery codes                                                                             |
| `packages/connectors` | SimpleFIN, Plaid, Teller clients behind one `Connector` interface                                                         |
| `packages/ai`         | Optional Claude features (BYO key)                                                                                        |
| `packages/services`   | Operations: validated, role- and scope-checked actions shared by the UI, Ask and MCP                                      |
| `packages/mcp`        | MCP server generated from the operation registry ([docs/agents.md](docs/agents.md))                                       |
| `packages/rewards`    | Card catalog generated from Open Credit Card Benefits, and the points-earning engine ([docs/rewards.md](docs/rewards.md)) |

Start with [docs/security.md](docs/security.md): it explains the invariants below.

## Invariants reviewers will check

1. **Money is integer minor units** (`bigint` cents) plus a currency code. Never floats. Parse user input with `parseDecimalToMinor`.
2. **Household data is read and written only inside `withHousehold(...)` / `inHousehold(...)`**, so Postgres row-level security applies. New household-scoped tables need a `household_id` column, an RLS policy in a migration, and an entry in `HOUSEHOLD_SCOPED_TABLES`.
3. **Every server action checks authorization first**: `denyUnless("member")` for edits, `requireStepUp()` for owner-only or sensitive actions. Validate every input with Zod. Prefer adding an **operation** in `packages/services` and calling it with `runOperation()`: it declares its role and scope once, and it becomes an MCP tool as well (see [docs/customizing.md](docs/customizing.md)).
4. **The web tier never holds long-lived bank credentials.** It seals one-time tokens to the worker's public key; only the worker decrypts.
5. **No new third-party scripts, fonts or trackers** in the browser. CSP is strict for a reason. The only existing exception is the bank-link widget (Plaid Link, Teller Connect), described in [docs/security.md](docs/security.md#web-hardening).
6. **Outbound requests** to user-supplied URLs must be validated (scheme, host) and use `redirect: "error"`.
7. **AI features stay opt-in and least-data**: send the minimum fields, never account numbers, and keep tools read-only.
8. **The MCP surface is never admin**: no bank linking, member or security management, AI settings or export through agent tokens.

## Database changes

Edit `packages/db/src/schema.ts`, then:

```bash
pnpm db:generate                                  # writes packages/db/drizzle/NNNN_*.sql
pnpm --filter @mm/db exec drizzle-kit generate --custom --name my_rls   # for policies/functions
```

Migrations must be additive and safe to run on a live instance; they run automatically on upgrade.

## Commits and sign-off

- Keep PRs focused; describe the _why_. Screenshots for UI changes, using demo data.
- Add tests: unit tests for logic in `packages/*`, integration tests for anything touching SQL/RLS, and E2E for user flows.
- **Sign off your commits** (`git commit -s`) to certify the [Developer Certificate of Origin](https://developercertificate.org/): you wrote the change or have the right to submit it under the project's license. A CI check fails a pull request with any commit missing a `Signed-off-by:` line that matches its author. To fix the last commit, run `git commit --amend -s --no-edit`; for several, run `git rebase --signoff main`, then force-push your branch.

## License

By contributing, you agree that your contributions are licensed under the [GNU AGPL-3.0-or-later](LICENSE), the same license as the project.
