# 0382 — A canvas is pixels already drawn, not a live connection

**Status: built.** Phase 2 of `docs/design/document-viewer.md`, the
phase the document itself named as *"the biggest phase, and the one
every later phase depends on."*

---

## What was asked

Phase 1 (decision 0381) closed with an open offer:

> Want me to start scoping and building that now, or would you rather
> sequence something else first?

> yes, please lets start scoping and building

One scoping question was asked and answered before writing anything:
the design document's own section 6 had left rotate and zoom state
undecided — *"reset per document on open, or remembered?"* — leaning
toward reset without deciding. Asked directly, the operator chose
**reset every time**: a session convenience, not data worth a place to
store it, settling the one open question phase 2 actually depended on.

---

## What was built

**One module, `page-renderer.js`, shared by every document kind.** A
thumbnail rail, one zoom (`ZOOM_STEPS`, seven steps, defaulting to
1×), one rotate (0/90/180/270), replacing the `<img>`/`<iframe>` split
`showPreview()` built directly since decision 0123. Every real
dependency — fetching, minting, pdf.js, drawing to a canvas — is
injected, the same seam decision 0380's `documentFrame()` already used
for `mint`: a test drives the widget and `resolvePages()` against
stubs, and nothing here has to run a real PDF engine or decode a real
image to be tested, nor fakes one badly instead.

**Two page-source shapes, told apart by asking, not by guessing from
the invoice.** `resolvePages(invoiceId, contentType, deps)`:

- A multi-page pending-document-sourced invoice (decision 0045) has
  real, separately-addressed pages. Decision 0381's
  `listRetainedPages` either finds them or finds none, and finding
  none is the ordinary case, not an error.
- Everything else has exactly one retained document: a PDF, rasterised
  page by page through pdf.js after minting its document URL, or a
  single image, which is one page — itself.

**pdf.js, vendored, not loaded from a CDN.** `workers/vf-ui/public/
vendor/pdfjs/` carries `pdf.min.mjs` and `pdf.worker.min.mjs` unmodified
from the published npm package (6.3.289, Apache-2.0), fetched with
`npm pack` and copied out of `build/` — no build step, matching how
every other file in `public/` is served (there is no bundler in this
Worker; the Assets binding serves plain files). The same choice
decision 0124 made for the font: nothing this application shows should
depend on a third party's uptime, and a customer's invoice should
never cause a request to leave this deployment's own origin. Loaded
lazily, only when a page turns out to be a PDF — most invoices are an
image or a set of retained pages and never pull in pdf.js's ~1.7MB at
all. `ALLOWED_ORIGINS` in `vf-app`'s CORS config already covers
`https://app.vibefinance-ai.com`, which is what lets pdf.js's own
internal `fetch()` — needed to actually read PDF bytes, unlike the
`<img>`/`<iframe>` it replaces — succeed cross-origin without a change
on that side.

**This retires decision 0380's whole problem, rather than fixing it
again here.** That frame's five-minute link could go stale while
somebody sat looking at it, because an `<iframe>` is a live connection
to a URL — reloading it, for any reason, asks the link again. **A
canvas is pixels already drawn.** Nothing reloads it, so nothing can
ask a token that has since expired. The link is used once, at load,
and never held open. The class of bug decision 0380 measured and
patched cannot recur in the Document tab; it still can in the XML tab,
which decision 0382 leaves untouched (still a live `<iframe>`, still
`documentFrame()`'s own guard).

**Icons and CSS.** `icons.js` gained `zoomin`, `zoomout`, `rotate` —
conventional shapes, the same reasoning `building` and `users` already
gave theirs. `index.html` gained the rail/canvas layout (`.vpagesroot`,
`.vrail`, `.vrailthumb`, `.vmain`, `.vcontrols`, `.vcanvasholder`, and
so on).

**Five new UI strings**, seeded in migration `0120` the same way every
`t()` key must be (decision 0107): `viewer.zoomin`, `viewer.zoomout`,
`viewer.rotate`, `viewer.pageof`, `viewer.thumbnails`.

---

## Tests, watched to fail

**`page-renderer.test.ts`, 24 tests.** `REAL_DEPS` completeness (every
key `pageViewer()` and `resolvePages()` actually call is really
there), `resolvePages()` telling the two shapes apart, and the widget
itself.

**A real bug, caught by the completeness check rather than inspection.**
`pageViewer()`'s `load()` calls `deps.resolvePages(...)`; the first
draft of `REAL_DEPS` had no `resolvePages` key at all — a `TypeError`
waiting in real use, never exercised by the widget tests because they
stub the whole page list and never touch `REAL_DEPS` at all. Found
only because a separate describe block exists purely to assert every
key is `typeof === "function"`. Watched fail by removing the line
again and rerunning: `expected 'undefined' to be 'function'`. Restored,
reconfirmed.

**`viewer.test.ts` and `documents.test.ts`, rewritten where they
asserted the structure this phase removed.** Four of five tests in
*"a frame asks for a fresh link only when it loads again"* (decision
0380) tested `<iframe>` reload behaviour that no longer exists for the
Document tab — retired with a comment saying why, not deleted quietly.
Two tests in the old *"the document preview (decision 0123)"* block
asserted `#vpreview iframe` / `#vpreview img` directly; replaced with
two asserting the new structure — a PDF and an image both land on
`.vpagesroot` and `canvas.vcanvas`, and neither leaves an `<iframe>`
or an `<img>` behind. Both files' shared `stubFetch()` helpers also
needed a default `/api/invoices/:id/pages` route, the same treatment
`purchase-orders.test.ts` already gives `/api/ui-strings` — every
existing test exercising the Document tab now triggers that fetch
through `resolvePages()`, and a strict stub helper throws loudly on
anything it wasn't told about, by design.

**vf-ui browser suite: 651 tests passing (was 631), 0 failures.** The
pre-existing 136 unhandled rejections (decision 0380) read 135 after
this change — recorded as measured, not investigated, matching this
project's own habit for that number. vf-ui Worker suite: 74 (unchanged).
vf-licence: 320, unchanged in count — `string-coverage.test.ts` checks
its whole `KEYS_THE_INTERFACE_USES` list in one assertion, not one test
per key, so five new keys move nothing in the total; verified by
running the suite against the pre-change tree, which also reads 320.
vf-app: 1912 (unchanged — this phase touches no `vf-app` file).
`tsc --noEmit` and `eslint` clean in both packages once the vendored
pdf.js files were added to eslint's own ignore list (`**/public/
vendor/**`) — a minified third-party file otherwise reports thousands
of spurious errors in code this project does not own and will not
edit, the same reasoning `node_modules` is already excluded.

---

## What is not built

- **Phases 3–5**: the embedded XML in a structured PDF as its own
  retained artifact, the pop-out window carrying the whole panel, and
  retiring the old preview and raw-file Expand — all still design
  only, all waiting on this phase, now built.
- **cMaps and standard fonts.** Not vendored alongside `pdf.min.mjs`.
  A PDF needing either still renders — pdf.js falls back to its own
  built-in substitute glyphs — just not pixel-faithfully. A known
  limitation, recorded rather than silently accepted.
- **A measurement in Safari or Firefox.** Only Chromium (via `vitest
  --config vitest.browser.config.ts`'s jsdom, and reasoning about the
  real browser rendering path) was considered — the same limitation
  decision 0380 already recorded for this codebase's testing.
- **Annotation** (decision 0206), now reachable in principle — every
  page has a known pixel geometry once drawn by code this project
  controls — but not attempted here. Its own, later piece.
