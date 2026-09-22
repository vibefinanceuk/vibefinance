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
      // decision 0384 moved every rule out of index.html's own inline
      // <style> block into app.css (a second real page,
      // document-window.html, needed the same classes without a
      // second copy of them) — app.css is what a typography test
      // means by "the stylesheet" now.
      const files = ["public/tokens.css", "public/index.html", "public/app.css"];
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
      "/boot.js": resolve(__dirname, "public/boot.js"),
      "/viewer.js": resolve(__dirname, "public/viewer.js"),
      "/signin.js": resolve(__dirname, "public/signin.js"),
      "/sources.js": resolve(__dirname, "public/sources.js"),
      "/processes.js": resolve(__dirname, "public/processes.js"),
      "/suppliers.js": resolve(__dirname, "public/suppliers.js"),
      "/purchase-orders.js": resolve(__dirname, "public/purchase-orders.js"),
      "/dashboard.js": resolve(__dirname, "public/dashboard.js"),
      "/workload.js": resolve(__dirname, "public/workload.js"),
      "/workload-open-tasks.js": resolve(__dirname, "public/workload-open-tasks.js"),
      "/workload-handling-time.js": resolve(__dirname, "public/workload-handling-time.js"),
      "/workload-cycle-time.js": resolve(__dirname, "public/workload-cycle-time.js"),
      "/workload-pending.js": resolve(__dirname, "public/workload-pending.js"),
      "/workload-queue-depth.js": resolve(__dirname, "public/workload-queue-depth.js"),
      "/workload-balance.js": resolve(__dirname, "public/workload-balance.js"),
      "/supplier-performance.js": resolve(__dirname, "public/supplier-performance.js"),
      "/accruals.js": resolve(__dirname, "public/accruals.js"),
      "/spend-under-management.js": resolve(__dirname, "public/spend-under-management.js"),
      "/fraud-duplicates.js": resolve(__dirname, "public/fraud-duplicates.js"),
      "/fraud-unapproved-suppliers.js": resolve(__dirname, "public/fraud-unapproved-suppliers.js"),
      "/fraud-exception-trends.js": resolve(__dirname, "public/fraud-exception-trends.js"),
      "/fraud-statistical-outliers.js": resolve(__dirname, "public/fraud-statistical-outliers.js"),
      "/fraud-segregation-of-duties.js": resolve(__dirname, "public/fraud-segregation-of-duties.js"),
      "/executive-consolidated-spend.js": resolve(__dirname, "public/executive-consolidated-spend.js"),
      "/executive-liabilities-by-entity.js": resolve(__dirname, "public/executive-liabilities-by-entity.js"),
      "/executive-supplier-concentration.js": resolve(__dirname, "public/executive-supplier-concentration.js"),
      "/executive-exception-trends.js": resolve(__dirname, "public/executive-exception-trends.js"),
      "/executive-throughput.js": resolve(__dirname, "public/executive-throughput.js"),
      "/supplier-status.js": resolve(__dirname, "public/supplier-status.js"),
      "/supplier-cycle-time.js": resolve(__dirname, "public/supplier-cycle-time.js"),
      "/supplier-exceptions.js": resolve(__dirname, "public/supplier-exceptions.js"),
      "/supplier-po-variance.js": resolve(__dirname, "public/supplier-po-variance.js"),
      "/supplier-payment-terms.js": resolve(__dirname, "public/supplier-payment-terms.js"),
      "/supplier-discount-eligibility.js": resolve(__dirname, "public/supplier-discount-eligibility.js"),
      "/supplier-hold-history.js": resolve(__dirname, "public/supplier-hold-history.js"),
      "/ap-assistant.js": resolve(__dirname, "public/ap-assistant.js"),
      "/ap-analytics.js": resolve(__dirname, "public/ap-analytics.js"),
      "/charts.js": resolve(__dirname, "public/charts.js"),
      "/mood.js": resolve(__dirname, "public/mood.js"),
      "/orgs.js": resolve(__dirname, "public/orgs.js"),
      "/icons.js": resolve(__dirname, "public/icons.js"),
      "/process-row.js": resolve(__dirname, "public/process-row.js"),
      "/rules.js": resolve(__dirname, "public/rules.js"),
      "/compose.js": resolve(__dirname, "public/compose.js"),
      "/rule.js": resolve(__dirname, "public/rule.js"),
      "/documents.js": resolve(__dirname, "public/documents.js"),
      "/access.js": resolve(__dirname, "public/access.js"),
      "/ap-setup.js": resolve(__dirname, "public/ap-setup.js"),
      "/readback.js": resolve(__dirname, "public/readback.js"),
      "/activity.js": resolve(__dirname, "public/activity.js"),
      "/page-renderer.js": resolve(__dirname, "public/page-renderer.js"),
      "/document-window.js": resolve(__dirname, "public/document-window.js"),
      // Resolved so Vite's static import analysis is satisfied, not so
      // it runs: nothing in this suite calls `loadPdfDocument`, the
      // only function that ever imports it (decision 0382).
      "/vendor/pdfjs/pdf.min.mjs": resolve(__dirname, "public/vendor/pdfjs/pdf.min.mjs"),
    },
  },
});
