import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run a production build against an isolated database (mm_e2e)
 * with its own least-privileged role. Requires Postgres from compose.dev.yml.
 */
const PORT = 3100;
const e2eDbUrl = new URL(
  process.env.TEST_DATABASE_ADMIN_URL ??
    "postgres://mm_admin:dev-admin-password@localhost:5432/money_manager",
);

export const E2E = {
  port: PORT,
  baseURL: `http://localhost:${PORT}`,
  adminUrl: Object.assign(new URL(e2eDbUrl), { pathname: "/mm_e2e" }).toString(),
  appRole: "mm_e2e_app",
  appPassword: "e2e-app-password",
};

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: E2E.baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Same artefact the Docker image runs: the standalone server with static assets copied in.
    command:
      "rm -rf .next/standalone/apps/web/.next/static && cp -R .next/static .next/standalone/apps/web/.next/static && node .next/standalone/apps/web/server.js",
    url: `${E2E.baseURL}/api/health?live`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: "production",
      PORT: String(PORT),
      HOSTNAME: "::",
      APP_URL: E2E.baseURL,
      ACCESS_MODE: "none",
      ALLOW_NO_ACCESS_GATE: "1",
      DATABASE_URL: Object.assign(new URL(E2E.adminUrl), {
        username: E2E.appRole,
        password: E2E.appPassword,
      }).toString(),
      AUTH_ENCRYPTION_KEY: "9wqsCU5oJk5TZ-c0V5cS7kQ0r2bYF6m4bE3p1oB9xQw",
      // Throwaway key (no private half kept): lets the web tier seal tokens in tests.
      WORKER_PUBLIC_KEY: "arwN9rpRiUkNt7YuJiTzPEH6pHKX4cmea2UDObSs7wE",
      // The real Anthropic SDK, pointed at e2e/fake-anthropic.ts: no key, no network, no cost.
      ANTHROPIC_API_KEY: "sk-ant-e2e-fake",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:3199",
    },
  },
});
