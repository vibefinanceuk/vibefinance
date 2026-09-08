import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { readFileSync, readdirSync, existsSync } from "node:fs";

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
/**
 * The stylesheets, as text — decision 0124.
 *
 * **Vite processes CSS before `?raw` sees it**, and returns an empty
 * string. A typography test reading an empty string passes everything,
 * which is worse than no test.
 *
 * Supplied as a virtual module instead, read from disk at config time.
 */
function stylesheetsAsText() {
  const VIRTUAL = "virtual:stylesheets";
  return {
    name: "stylesheets-as-text",
    resolveId: (id: string) => (id === VIRTUAL ? `\0${VIRTUAL}` : null),
    load(id: string) {
      if (id !== `\0${VIRTUAL}`) return null;
      const files = ["public/tokens.css", "public/index.html"];
      const contents = Object.fromEntries(
        files.map((f) => [f.split("/").pop(), readFileSync(resolve(__dirname, f), "utf8")])
      );
      // The fonts actually on disk, so a stylesheet naming one that is
      // not shipped fails rather than falling back silently.
      const fontDir = resolve(__dirname, "public/fonts");
      const fonts = existsSync(fontDir) ? readdirSync(fontDir) : [];

      return (
        `export default ${JSON.stringify(contents)};\n` +
        `export const shippedFonts = ${JSON.stringify(fonts)};`
      );
    },
  };
}

export default defineConfig({
  plugins: [stylesheetsAsText()],
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
      "/sources.js": resolve(__dirname, "public/sources.js"),
      "/mood.js": resolve(__dirname, "public/mood.js"),
      "/icons.js": resolve(__dirname, "public/icons.js"),
      "/process-row.js": resolve(__dirname, "public/process-row.js"),
      "/rules.js": resolve(__dirname, "public/rules.js"),
      "/compose.js": resolve(__dirname, "public/compose.js"),
      "/rule.js": resolve(__dirname, "public/rule.js"),
      "/documents.js": resolve(__dirname, "public/documents.js"),
      "/readback.js": resolve(__dirname, "public/readback.js"),
    },
  },
});
