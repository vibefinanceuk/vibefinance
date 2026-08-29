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
//
// wrangler.test.jsonc, not wrangler.jsonc: the real config declares an
// `ai` binding, and merely declaring one makes the pool try to open a
// real remote connection for it before any test runs, which needs
// credentials this session doesn't have. See wrangler.test.jsonc's own
// comment for the full explanation.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.test.jsonc" } })],
});
