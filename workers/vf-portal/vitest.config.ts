import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // vf-licence does not exist here: refused, so nothing passes for the wrong reason.
        serviceBindings: {
          LICENCE_SERVICE: () =>
            new Response(JSON.stringify({ error: "vf-licence is not available in tests" }), {
              status: 503,
              headers: { "Content-Type": "application/json" },
            }),
        },
      },
    }),
  ],
});
