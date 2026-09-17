# Vendored: pdfjs-dist 6.3.289

`pdf.min.mjs` and `pdf.worker.min.mjs`, unmodified, from the published
npm package (Apache-2.0, see `LICENSE`). Fetched via `npm pack
pdfjs-dist@6.3.289` and copied out of `build/` — no build step, matching
how `public/*.js` is served in this Worker (decision 0382's page
renderer, phase 2 of `docs/design/document-viewer.md`).

Self-hosted rather than loaded from a CDN, the same choice decision
0124 made for the font: nothing this application shows should depend
on a third party's uptime, and a customer's invoice data should never
cause a request to leave this deployment's own origin.

Not vendored: the cMaps and standard-fonts packages pdf.js can
optionally use for CJK text and non-embedded font fallback. A PDF that
needs either still renders — pdf.js falls back to its own built-in
substitute glyphs — just not pixel-faithfully. Known limitation,
recorded rather than silently accepted.

To update: `npm pack pdfjs-dist@<version>`, extract, replace both
files, bump the version above.
