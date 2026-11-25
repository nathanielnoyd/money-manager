import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for server-side helpers in src/lib. User flows are covered by Playwright (e2e/).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"] },
});
