# syntax=docker/dockerfile:1.7
# One Dockerfile, two images:  --target web  |  --target worker
# Multi-arch (amd64 + arm64) so it runs on ARM servers, Raspberry Pi and Apple silicon.

ARG NODE_IMAGE=node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8

FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION=12.14.0
RUN npm install -g pnpm@${PNPM_VERSION} && npm cache clean --force
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo

# ── dependencies (cached unless a manifest or the lockfile changes) ──
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/crypto/package.json packages/crypto/
COPY packages/ai/package.json packages/ai/
COPY packages/connectors/package.json packages/connectors/
COPY packages/db/package.json packages/db/
COPY packages/services/package.json packages/services/
COPY packages/mcp/package.json packages/mcp/
COPY packages/rewards/package.json packages/rewards/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ── build ──
FROM deps AS build
COPY . .
RUN pnpm --filter @mm/web build && pnpm --filter @mm/worker build

# ── web: Next.js standalone server ──
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:3000/api/health?live" >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]

# ── worker (also runs the one-shot migrate job) ──
FROM ${NODE_IMAGE} AS worker
ENV NODE_ENV=production MIGRATIONS_DIR=/app/drizzle HEARTBEAT_FILE=/tmp/worker-heartbeat
WORKDIR /app
COPY --from=build /repo/apps/worker/dist ./dist
COPY --from=build /repo/packages/db/drizzle ./drizzle
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "process.exit(Date.now()-require('fs').statSync(process.env.HEARTBEAT_FILE).mtimeMs<120000?0:1)"
CMD ["node", "dist/index.mjs"]
