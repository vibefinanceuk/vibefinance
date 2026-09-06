import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * The browser code, in a DOM — decision 0121.
 *
 * **The Worker tests cannot reach it.** `vitest-pool-workers` runs in
 * `workerd`, which has no `document`, so `public/*.js` has never been
 * executed by anything: 43 tests covering routing, proxying and cookies
 * while the panel rendering, the field highlighting and three real bugs
 * sat outside all of them.
 *
 * A second config rather than a second environment in the first,
 * because the pool decides where a test runs and cannot be overridden
 * per file.
 */
export default defineConfig({
  /**
   * Vite copies `public/` verbatim and refuses to import from it —
   * which is right for a build and wrong here, since `public/` is
   * exactly the code under test. Turned off rather than moving the
   * files, because where they live is what Cloudflare serves.
   */
  publicDir: false,
  test: {
    name: "browser",
    environment: "jsdom",
    include: ["test-browser/**/*.test.ts"],
  },
  resolve: {
    /**
     * The browser modules import each other by **absolute path** —
     * `import { t } from "/strings.js"` — because that is what a
     * browser resolves against the server root.
     *
     * Aliased rather than changed: rewriting them to relative paths for
     * the tests' benefit would make the tested code differ from the
     * shipped code, which is the whole failure this is meant to close.
     */
    alias: {
      "/strings.js": resolve(__dirname, "public/strings.js"),
      "/tasks.js": resolve(__dirname, "public/tasks.js"),
      "/viewer.js": resolve(__dirname, "public/viewer.js"),
      "/signin.js": resolve(__dirname, "public/signin.js"),
    },
  },
});
