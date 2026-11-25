# Customizing your instance

There are three levels, from no code at all to running your own fork.

## 1. Settings, from the app or your agent

Rules, categories, budgets, goals and alerts can all be changed in **Settings**. The same changes can be made through the [MCP server](agents.md), so you can ask your agent:

> "Make a rule that puts every 'COSTCO GAS' charge under Gas, apply it to past transactions, and add a 'Kids' category under Lifestyle."

## 2. Change the code with a coding agent

Money Manager is meant to be forked. `AGENTS.md` at the repository root (Claude Code also reads it through `CLAUDE.md`) gives a coding agent a map of the code and lists the rules it must never break. `.claude/skills/` has step-by-step recipes for the most common changes:

| Skill           | Use it to                                                                       |
| --------------- | ------------------------------------------------------------------------------- |
| `add-operation` | Add a capability that appears in the UI, in Ask, and as an MCP tool all at once |
| `add-connector` | Add a bank data provider                                                        |
| `add-alert`     | Add a push alert type                                                           |

In Claude Code, describe what you want ("add an MCP tool that lists my largest refunds this year") and the matching skill loads automatically.

### Stable extension points

These are designed to be extended, and upstream tries not to break them:

| Path                                    | What you add                                                |
| --------------------------------------- | ----------------------------------------------------------- |
| `packages/services/src/operations/*.ts` | Operations (UI, Ask and MCP capabilities)                   |
| `packages/connectors/src/*.ts`          | Connectors implementing the `Connector` interface           |
| `packages/core/src/*.ts`                | Pure domain logic (no I/O), such as alert rules and parsers |
| `packages/core/src/categories.ts`       | Default categories for new households                       |

Everything else (auth, crypto, the RLS migrations, the sync engine) is internal. Change it only if you're prepared to resolve conflicts with upstream yourself.

### Adding an operation

```ts
// packages/services/src/operations/reads.ts
export const largestRefunds = defineOperation({
  name: "largest_refunds", // also the MCP tool name
  title: "Largest refunds",
  description:
    "The biggest money-in transactions from merchants (refunds) in a date range. Dollars.",
  input: z.object({
    start: DateStr,
    end: DateStr,
    limit: z.number().int().min(1).max(50).default(10),
  }),
  minRole: "viewer",
  scope: "read",
  readOnly: true,
  async run(tx, _principal, { start, end, limit }) {
    // tx is already scoped to the caller's household (row-level security).
    // …query, then return dollars, never account numbers.
  },
});
// …and add it to READ_OPERATIONS at the bottom of the file.
```

That's all it takes for it to appear in `tools/list` for every token with the `read` scope. To call it from the UI, use `runOperation(largestRefunds, input)` in a server action.

## 3. Build and run your fork

```bash
git clone https://github.com/<you>/money-manager && cd money-manager
git remote add upstream https://github.com/nathanielnoyd/money-manager
# make your changes, then:
pnpm install && pnpm lint && pnpm typecheck && pnpm test
docker compose build            # builds web and worker images from your checkout
docker compose up -d
```

`docker compose build` tags your images `money-manager-web:local` and `money-manager-worker:local`, which is what `docker-compose.yml` runs unless you set `MM_IMAGE_PREFIX` and `MM_VERSION` to pull published releases instead. For your fork, leave those unset (or set `MM_IMAGE_PREFIX` to your own registry).

To stay current, rebase on upstream regularly (`git fetch upstream && git rebase upstream/main`). Migrations run automatically on start. Keep your own migrations additive, and generate them after rebasing so their numbers follow upstream's.
