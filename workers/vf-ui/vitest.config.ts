import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        /**
         * `vf-licence` does not exist here, and the Worker declares a
         * Service Binding to it (decision 0005 — a Worker cannot
         * plain-`fetch()` another Worker's `workers.dev` URL).
         *
         * Stubbed rather than removed from the config, so the tests run
         * against **the same bindings the deployment has**. A test
         * config that quietly drops a binding is a test environment
         * that differs from production in exactly the way that hides
         * binding problems.
         *
         * It returns a refusal rather than a plausible success: nothing
         * here should depend on `vf-licence` answering, and a stub that
         * pretended to would let a test pass for the wrong reason.
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
