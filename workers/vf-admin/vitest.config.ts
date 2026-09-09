import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        /**
         * `vf-licence` is a real Worker and not one this suite runs.
         *
         * **The stub refuses rather than answering**, following
         * `vf-ui`'s own note: a stub that pretended to succeed would
         * let a test pass for the wrong reason. Nothing here depends on
         * the control plane answering — what is under test is whether a
         * request is allowed to reach it at all.
         */
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
