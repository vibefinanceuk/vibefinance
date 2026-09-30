import { decodeText, detectCsvOptions, parseCsv } from "@vibefinance/shared";

/**
 * **A CSV as a table a person can read — decision 0565.** Decision 0205
 * renders an XML invoice at capture, because *"a plain XML invoice has
 * nothing a person can look at"*; a CSV is the same. Rendered once, at
 * capture, as the `generated_rendering` beside the original, so the viewer
 * shows the rows as they arrived rather than a download.
 *
 * Every row is shown as written, with the separator guessed from the file.
 * At most 500 rows: an invoice file with more is not an invoice anyone
 * reads row by row, and the original is kept in full either way.
 */
const MAX_ROWS = 500;

const escapeHtml = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderCsvTable(bytes: Uint8Array, filename = "CSV"): { html: string | null; reason?: string } {
  const text = decodeText(bytes);
  const options = detectCsvOptions(text);
  const rows = parseCsv(text, options.delimiter);
  if (rows.length === 0) return { html: null, reason: "the file has no rows" };
  const shown = rows.slice(0, MAX_ROWS + (options.header ? 1 : 0));
  const head = options.header ? shown[0] : null;
  const body = options.header ? shown.slice(1) : shown;
  const more = rows.length - shown.length;
  const cell = (tag: string, v: string) => `<${tag}>${escapeHtml(v)}</${tag}>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(filename)}</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:13px;margin:16px;color:#1d2433;background:#fff}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #d6dbe4;padding:4px 8px;text-align:left;vertical-align:top;white-space:pre-wrap}
th{background:#f1f4f8;font-weight:600}
tr:nth-child(even) td{background:#fafbfc}
p{color:#5b6475}
</style></head><body>
<table>${head ? `<thead><tr>${head.map((v) => cell("th", v)).join("")}</tr></thead>` : ""}<tbody>${body
    .map((r) => `<tr>${r.map((v) => cell("td", v)).join("")}</tr>`)
    .join("")}</tbody></table>${more > 0 ? `<p>${more} more rows are in the original file.</p>` : ""}
</body></html>`;
  return { html };
}
