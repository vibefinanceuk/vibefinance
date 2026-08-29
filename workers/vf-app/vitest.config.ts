import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// @cloudflare/vitest-pool-workers@0.22.0 has no "./config" subpath export
// and no longer works with the Vitest 3-style `test.pool` string +
// `poolOptions.workers` shape — Vitest 4 replaced that mechanism with a
// `config.poolRunner` object (see its "pool rework" migration guide).
// The package's own `cloudflareTest` plugin is what wires poolRunner,
// the required resolve conditions/mainFields, and the `cloudflare:test`
// virtual module up together; it is the supported entry point,
// discovered by reading dist/pool/index.mjs since none of this is in
// the exports map or an easily-found doc page yet. Worth revisiting on
// the next @cloudflare/vitest-pool-workers upgrade.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
});
