import { build } from "esbuild";

// Bundle the worker, migrate and recover entrypoints into self-contained ESM files for the container.
await build({
  entryPoints: {
    index: "src/index.ts",
    migrate: "src/migrate.ts",
    recover: "src/recover-cli.ts",
  },
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: true,
  outExtension: { ".js": ".mjs" },
  external: ["pg-native"],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "info",
});
