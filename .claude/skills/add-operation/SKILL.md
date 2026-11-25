---

name: add-operation
description: Add a capability to Money Manager that appears in the web UI, the Ask feature and the MCP server at once. Use when asked to add an MCP tool, an agent capability, or a new read or write action over household data.
---

# Add an operation

Operations live in `packages/services/src/operations/`. Each one becomes an MCP tool automatically (name, description, JSON Schema from Zod, annotations), gated by its `minRole` and `scope`.

1. **Choose the file and the gate.**
   - Read-only: `reads.ts`, with `minRole: "viewer"`, `scope: "read"` and `readOnly: true`.
   - Transaction edits: `transactions.ts`, with `"member"` and `"transactions:write"`.
   - Rules, budgets, goals and categories: `planning.ts`, with `"member"` and `"planning:write"`.
   - A new area that needs a new scope: add it to `SCOPES` and `SCOPE_INFO` in `operation.ts`, and update the scope list in `docs/agents.md`.
   - Never expose admin actions (members, connections, security, export). See AGENTS.md invariant 8.
2. **Define it** with `defineOperation({...})`:
   - `name` is snake_case, unique, and doubles as the tool name.
   - `description` is written for an agent: what it does, when to use it, units (dollars, YYYY-MM-DD).
   - `input` is a `z.object`. Use `DateStr`, `MonthStr` and `Dollars` from `../util`. Cap list sizes and limits.
   - `run(tx, principal, input)` runs with `tx` already scoped to the household. Convert dollars with `cents()` and `dollars()`. Check foreign ids with `ownsAll()`. For expected failures, throw `new OperationError("not_found" | "conflict" | ..., "Message a person can read")`.
   - Never return account numbers, masks or secrets.
   - Set `idempotent: true` or `destructive: true` where they apply.
3. **Register it** in the file's exported list (`READ_OPERATIONS`, `TRANSACTION_OPERATIONS` or `PLANNING_OPERATIONS`).
4. **Use it from the UI** (optional): in a server action, call `runOperation(op, input, { invalidMessage })` from `@/lib/household`, then `revalidatePath(...)` when `r.ok`.
5. **Test it** in `packages/services/src/services.test.ts`: test the happy path, test that a viewer or a token without the scope is refused, and test that another household's ids aren't reachable.
6. Run `pnpm lint && pnpm typecheck && pnpm test`. If you changed what agents can do, update the tool table in `docs/agents.md`.
