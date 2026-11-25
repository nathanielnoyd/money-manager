## What and why

<!-- What does this change, and what problem does it solve? Link issues with "Fixes #123". -->

## How I tested it

<!-- Commands run, tests added, screenshots (demo data only). -->

## Checklist

- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass
- [ ] Household data is only touched inside `withHousehold` / `inHousehold` (RLS applies)
- [ ] New server actions check the role first (`denyUnless` / `requireStepUp`) and validate input
- [ ] No real financial data, secrets or third-party browser scripts added
- [ ] Docs updated if behavior or configuration changed
- [ ] Commits are signed off (`git commit -s`)
