# AGENTS.md

Guidance for coding agents (Claude Code, Codex, Cursor and others) working in this repository. People should start with [CONTRIBUTING.md](CONTRIBUTING.md). It says the same things at greater length.

Money Manager is a self-hosted personal finance app holding **real financial data**. Correctness and security outrank speed. When in doubt, ask.

## Map

| Path                  | What lives there                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `apps/web`            | Next.js App Router: pages, server actions (thin wrappers over operations), auth, `/api/mcp`           |
| `apps/worker`         | pg-boss jobs: bank sync, alerts, AI digest. The only process that can decrypt bank tokens             |
| `packages/services`   | **Operations**: the one definition of what callers can do (used by the UI, Ask and MCP), agent tokens |
| `packages/mcp`        | MCP server built from the operation registry                                                          |
| `packages/rewards`    | Card catalog generated from Open Credit Card Benefits (CC BY 4.0) and the pure points-earning engine  |
| `packages/core`       | Pure domain logic: money, dates, budgets, rules, parsers, recurring, alerts. No I/O                   |
| `packages/db`         | Drizzle schema, migrations, RLS policies, ingest engine, seed data, test database helper              |
| `packages/connectors` | SimpleFIN, Plaid, Teller behind the `Connector` interface                                             |
| `packages/crypto`     | Sealed boxes, secretbox, TOTP, recovery codes                                                         |
| `packages/ai`         | Optional Claude features (bring your own key)                                                         |

Design docs: [docs/architecture.md](docs/architecture.md), [docs/security.md](docs/security.md), [docs/rewards.md](docs/rewards.md).

## Invariants (never break these)

1. **Money is `bigint` minor units (cents) in the database.** Operation inputs and outputs use dollars, and convert with `cents()` / `dollars()` from `@mm/services`. Never store floats.
2. **Household data is touched only inside `withHousehold()`**, whether directly or through `execute()`, `inHousehold()` or `runOperation()`, so Postgres row-level security applies. A new household table needs `household_id`, an RLS policy in a custom migration, and an entry in `HOUSEHOLD_SCOPED_TABLES`.
3. **Check ids that callers supply before storing them as references.** Foreign keys ignore RLS. Use `ownsAll(tx, "categories" | "accounts" | "categoryGroups", ids)`.
4. **Authorization comes before work.** Operations declare `minRole` and `scope`. Server actions that aren't operations call `denyUnless()` or `requireStepUp()` first. Validate every input with Zod.
5. **The web tier never decrypts bank credentials.** It seals them to the worker's public key.
6. **No third-party scripts, fonts or trackers in the browser.** The CSP is strict. The one exception is the bank-link widget of a provider the operator configured (Plaid Link, Teller Connect), loaded only when someone clicks Connect; see [docs/security.md](docs/security.md#web-hardening). Don't add another.
7. **Outbound requests to user-supplied URLs** must check the scheme and host and use `redirect: "error"`.
8. **The MCP surface is never admin.** No bank linking, members, security settings, AI settings, export or account deletion. Write operations need `minRole: "member"` or higher and a write scope.
9. **Treat bank descriptions, merchant names and notes as untrusted text**, especially in anything an LLM reads.
10. **Never weaken a test to make it pass.** Fix the code, or explain why the test is wrong.

## Commands

```bash
pnpm install
docker compose -f compose.dev.yml up -d   # Postgres on 127.0.0.1:5432
pnpm dev:setup && pnpm db:migrate && pnpm db:seed && pnpm dev
pnpm lint            # Biome (pnpm format to fix)
pnpm typecheck
pnpm test            # unit + integration (needs the dev Postgres)
pnpm --filter @mm/web build && pnpm --filter @mm/web test:e2e   # Playwright, production build
```

Before you finish a change, run `pnpm lint`, `pnpm typecheck` and `pnpm test`. Run the E2E suite too if you touched the UI, auth or server actions.

## Recipes

Step-by-step skills live in `.claude/skills/`:

- **add-operation**: a new capability that appears in the UI, in Ask and as an MCP tool all at once
- **add-connector**: a new bank data provider
- **add-alert**: a new push alert type
- **import-card-catalog**: regenerate the shipped card catalog from an Open Credit Card Benefits checkout

Database change: edit `packages/db/src/schema.ts`, run `pnpm db:generate`, and write policies and functions with `pnpm --filter @mm/db exec drizzle-kit generate --custom --name <name>`. Migrations must be additive.

## Style

Strict TypeScript. Prefer small pure functions in `@mm/core`, with tests next to them. Write user-facing copy in plain, calm sentences. Write operation descriptions for an agent: say what the operation does, when to use it, and what units it takes.
