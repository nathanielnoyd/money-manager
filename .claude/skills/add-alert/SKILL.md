---

name: add-alert
description: Add a new push-notification alert type (ntfy) to Money Manager. Use when asked for a new kind of alert or notification.
---

# Add an alert

1. Read `packages/core/src/alerts.ts`. Alerts are computed by pure functions from facts gathered after each sync, then deduplicated in `notification_log` by key.
2. Add the alert kind and its pure detection function in `@mm/core`, with a unit test next to it (see `invest-alerts.test.ts`).
3. Gather the facts it needs in `apps/worker/src/jobs/alerts.ts` (inside `withHousehold`). Leave amounts out of the message when the household's `includeAmounts` setting is false.
4. Add its toggle and threshold to the notification settings schema and form (`apps/web/src/app/(app)/settings/notifications/`).
5. An alert must never break a sync. Catch errors and log them without secrets or amounts.
6. Run `pnpm test` (worker alert tests included).
