# VibeFinance — Progress and Status

Last updated 17 September 2026. A living document: what is built, what
is not, and what is known to be uncertain.

The decision records in `docs/decisions/` are the authority on *why*
anything is the way it is. This is the map.

**Picking this up cold?** `docs/HANDOVER.md` is the starting point —
where things stand, what needs a decision rather than work, and what to
do next.

---

## What the system does today

An invoice enters through one of three paths, and the difference
between them matters more than it first appears:

| Path | How | Nature |
|---|---|---|
| UBL / XML | Parsed directly | **Exact** |
| Hybrid PDF (Factur-X, ZUGFeRD) | Embedded XML extracted, then parsed | **Exact** |
| Photograph or scan | Vision model | **Inferred** |

The first two are deterministic and carry mandate-grade data. The
third is best-effort and is marked as such in its own response —
`documentPath: "image-extraction"`, a confidence score, and a list of
fields that could not be read.

**And a fourth outcome, which is not a path but the absence of one.** A
document nothing could read becomes an invoice with no facts, waiting
for a person to key it (decision 0055) — and **the screen now says
so**, with what was tried and the document itself alongside (0161,
0166). A photographed invoice that exceeds what the model can do in the
time available takes the same route rather than being lost (0163).

**A document arrives by email**, in practice and not only in principle:
a supplier sends to an address a source owns, every attachment is
captured, and every arrival is logged with its outcome and reason
(0146, 0147, 0162).

**And it places itself.** A source chooses a fixed business unit or
`<Automatic>`, and `<Automatic>` reads the buyer's own identifiers off
the document — the electronic address Peppol routes on, then the VAT
id, then the buyer's routing reference (0204). Where it cannot, it
records **which** of three reasons applied rather than leaving a blank.

**And it names the company that was billed** (0226). An invoice bills a
legal entity — the one with the tax identifier — matched on the buyer's
electronic address or VAT number. **Which department bears the cost is a
line-level question** and is not built.

**The supplier mirror runs end to end** (0207–0219): a CSV loads from
the customer's ERP, an arriving invoice matches on the seller's endpoint
or VAT id, a **pay site** wins where several sites share a number, and a
load re-matches whatever was unmatched. Both party cards show our own
record beside the image, with a search on each for choosing by hand.

**A UBL invoice is rendered as a document** (0205, 0206): A4 portrait,
at capture, stored beside the original, using OpenPEPPOL's own CSS,
code lists and labels — with a notice saying it is a rendering and of
what, which survives printing.

A hybrid PDF is never sent to a model. That is the point of checking
for embedded XML first, and a PDF submitted to the image endpoint is
refused outright rather than silently degraded.

From there: facts are stored, a workflow instance is created, its
stages are visited, rules compiled from natural language are
evaluated, and matching rules spawn real tasks for real people.

**And a person can now do something about it.** They sign in at
`vf-ui`, see their tasks across every stage, claim one, and key the
document behind it — in their own language and the customer's colours.

**Verified end to end on live infrastructure**: a photograph of a
supplier invoice produced correct structured EN 16931 facts, matched
a rule, and left an approval task in a queue.

---

## Built and live

### The rule engine
- Closed vocabulary, now **typed** — every field declares text,
  number, date or boolean (0041)
- Natural-language compiler with a real refusal boundary
- Worked examples, self-verified against the real interpreter
- Confirmation and activation gate — no rule runs unconfirmed
- Multi-vocabulary: invoice, expense, and per-customer extensions
- Type-aware validation refuses operator/type mismatches at compile
  time, catching rules that would otherwise silently never fire
- Deterministic invoice validation, setting `validation.passed` and
  `validation.failures` as real facts rules can test, recorded on the
  stage visit for audit (0044)
- Line-level extraction from images, which is what lets the line-sum
  check run at all
- Multi-page capture: pages accumulate separately, then extract
  together in one model call (0045)

### Sources and intake
- Sources as their own thing: transport instances bound to a process (0060)
- Intake channels as per-process structural handlers (0061)
- Structure detection, most-specific-first (0062)
- Capture addressed to a source, detection choosing the channel (0063)
- UBL/XML capture (0030)
- Hybrid PDF with embedded-XML extraction (0042)
- Image extraction via vision model (0043), multi-page, one call per page (0046, 0047)
- An undetectable document captured with provenance and no facts, reaching a person (0063)
- Per-channel extraction settings, reaching extraction and validation (0053, 0056, 0057)
- Intake events recording every rejection with a reason

### The workflow engine
- Processes, stages, instances, stage visits
- Tasks, teams, permissions
- Rule sets bound to stages
- **Real version control for a process** (0349), finishing what
  decisions 0150 and 0160 designed and built the foundation for but
  left with "nothing creates a v2." A draft is not new schema — it is
  the rows already sitting at `processes.version + 1`, real the
  moment the first edit is made and gone entirely if discarded;
  publishing moves nothing but `processes.version` to point at rows
  already there. `ensureDraftExists` copies the live version's own
  membership forward on the first edit, so every later edit changes
  something that already exists rather than a blank slate. Drag-to-
  reorder for a draft's own stages (0352); a real entry point into
  modifying an existing process, since none existed before (0353); "New
  draft" wording with both its own action and Add stage moved into the
  card's own head, consistent with the rest of the app (0354). Two
  more real, previously-unauthenticated write routes closed alongside
  this (`POST /processes` and `POST /processes/:id/stages`), plus a
  separate, fourth gap in the same arc: the second of those two routes
  has existed since decision 0018, real and tested in `vf-app`, and had
  never once been added to `vf-ui`'s own proxy allow-list — the exact
  pattern decision 0212 already documents.
- **A real bug in the Rules screen's own stage list, found live**
  (0351): `handleRuleStages` read every stage from every process in
  one flat list, `WHERE process_id = ?` never applied at all — fixed
  with a real process selector rather than a client-side filter over
  data that was already wrong. **A missing filter is not "show
  everything"** (0355): a process with no stages showed every rule in
  the system rather than none, the same class of bug in the opposite
  direction. Spacing (0356) and button placement — Pause and Write a
  new version moved into the rule card's own head (0357) — round out
  this arc.
- **Supplier Maintenance, a real, separate workflow** (0350), not a
  stage bolted onto the existing AP process — the operator's own
  reasoning: "a separate process flow would be more efficient for
  monitoring and reporting." Closes a gap named years earlier and left
  open on purpose: decision 0231 built `supplier.awaitingErp`
  specifically so a rule could route on it, and decision 0233 said
  plainly that building the trigger then would have meant guessing at
  which team and which stage — this is that rule, written once a real
  team and stage existed to write it against.

### Real, permission-based access — extended to Suppliers (0358)
- **Reading the supplier list had never been unit-scoped at all** —
  `AP.Supplier` gated it alone, with no permission-based visible set to
  intersect against, unlike `AP.Review`, which Documents, Tasks, and
  the dashboard already narrow correctly. `Scope` and `unitClause`
  moved out of `dashboard-route.ts` into `enforce.ts`, the shared home
  `unitsWherePermitted` and `scopedToChosenOrg` already live in, rather
  than a second copy of the same "an unassigned unit stays visible"
  exception drifting apart over time.
- **The dashboard's own supplier card scoped correctly, not by
  reusing the wrong permission.** Its shared `scope` is computed from
  `AP.Review` — using it as-is for a supplier card would have made the
  card's own count silently disagree with what the Suppliers screen
  itself shows the same person. `scopeFor` was generalised to take the
  permission as a parameter, with a second, `AP.Supplier`-based scope
  computed specifically for this card. Purchase Orders' own access
  control (decision 0375) and the search/pagination work built on top
  of both screens (0376, 0378) reuse this exact mechanism rather than
  building a third copy.

### The Dashboard — default landing, layout, and "Waiting for me" (0359–0369)
- **The Dashboard, not Tasks, is the default screen at login** (0359).
- **Two real width bugs, in the one place each fix didn't look**
  (0360, 0361): `body`'s own "working" class, which controls full-
  width layout, was being set in more than one place and inconsistently
  on first load versus a later navigation — fixed once, in one place,
  after the first fix (0360, the Dashboard/Tasks toggle) missed the
  identical gap on the sign-in screen itself (0361).
- **The org switcher relaunches whatever screen is open, rather than
  reloading the whole page to the default one** (0362) — replacing
  `location.reload()` (decision 0314's own choice, reasoned at the time
  as the only option) with `go()`, built later for nav clicks and
  reused here rather than duplicated. One exception, exactly as asked:
  a document or task with real focus falls back to the default screen
  instead, since that specific record belongs to the org being
  navigated away from.
- **A bar chart for Waiting for Me, broken down by queue** (0363), and
  two real, live-reported bugs fixed in its own wake: the count on
  the card disagreeing with the count after actually clicking it
  (0368 — the card asked the wrong question of the same data), and a
  subtitle rendered twice over (0367).
- **Card layout, arrived at after three attempts, not one.** A third
  band for cards that fit three across (0364, "as a first try");
  `.dashthird` made to grow and fill rather than leave empty tracks
  once a card moved elsewhere (0365); then the bands themselves
  removed entirely (0366), once each earlier fix made the same
  underlying problem smaller without ever closing it — a card's own
  stored order and the band sorting it into disagreeing, so a card
  that changed weight moved to a different band regardless of how many
  times it had been moved up. One flow now (`.dashflow`, `flex-wrap:
  wrap`), rendering every card in exactly the order it is stored in;
  a card's own width is read from what it structurally is (whether it
  draws a chart) rather than a setting somebody has to keep in sync.
- **Save changes and Close, top right, in the add-a-card pop-out**
  (0369), the same consistency pass every other pop-out has already
  had.

### Purchase orders and matching
- Purchase order storage grounded in Peppol BIS Order Only 3.3, via UBL
  XML ingestion (0081) and CSV load (0370) — the same tables, the same
  replace-on-resubmit semantics, either way in
- `po.matched` / `po.variance_pct` (header) and `po.line_matched` /
  `po.line_variance_pct` / `po.line_quantity_variance_pct` (line, via
  `BT-132`), computed live at every evaluation rather than stored, so a
  purchase order arriving after its invoice is still reflected
  correctly (0370)
- Tolerance reuses the existing per-supplier
  `amountTolerancePct`/`quantityTolerancePct` (0209); no positional
  fallback when `BT-132` is absent, per EN 16931's own warning that
  correspondence isn't guaranteed even when `BT-13` is present
- A CSV upload screen (0371), `Admin.Configure`, in Configuration
  alongside Sources; fixed two real, pre-existing gaps found while
  building it: the proxy allowlist never carried either purchase-order
  route (decisions 0081, 0370 both unreachable through the UI until
  now), and `vf-licence`'s own test setup was missing fifteen
  migrations' worth of UI strings entirely, unrelated to this screen
- A list beneath the loader, and a detail pop-out on a clicked row
  showing every header and line field on file (0372) — `AP.Validate`
  on the new list route, reusing exactly the permission the
  single-order lookup already settled on in 0081 rather than a second
  one for the same kind of read; the detail pop-out needed no new
  backend route at all, since that same single-order lookup had sat
  unused by any screen since 0081. Found and fixed the same class of
  bug decision 0191 first named for Suppliers: `open()` on both this
  screen and Suppliers' own called `note()` before the element it
  writes to had ever been rendered, so a failed first load said
  nothing to anyone on either screen until a real test finally
  exercised the case
- A CSV format reference and template download (0373), on the
  operator's own observation that the one-line load hint left a person
  with no way to discover the other nineteen accepted columns. The
  parser's own alias lookup maps are now derived from one richer
  structure (`HEADER_FIELD_SPECS`/`LINE_FIELD_SPECS`) that the new
  `GET /purchase-orders/csv-format` also reads, so the documented
  format can never drift from what the parser actually accepts —
  proven by a test that builds a file from every column the endpoint
  advertises and confirms the real loader accepts all of them. The
  template download is the first client-side generated-file download
  anywhere in this app
- Which legal entity a purchase order belongs to (0374), derived from
  the buyer tax reference rather than a second, explicit field —
  reusing invoices' own VAT-matching logic (0111, 0226) via a newly
  shared `matchLegalEntity()`, not a second copy of it. Unlike
  invoices, missing or unmatched is refused outright rather than stored
  with a null org, since a purchase order describes the buyer's own
  system to itself rather than a document a third party could
  misaddress. The list is scoped by the chosen org through the same
  mechanism Tasks, Documents, and Suppliers already use
- Real, permission-scoped access control, not just the org switcher's
  own browsing convenience (0375). `AP.Validate` now computes a real
  scope via `unitsWherePermitted`, the same mechanism `AP.Supplier`
  already uses for Suppliers (0358) — the chosen org narrows further
  within it but can never widen past what a role actually permits. The
  detail route gained the identical real scope, deliberately without
  also intersecting the chosen org, since the switcher is a personal
  view preference, not a second lock; a new `isWithinScope` helper in
  `enforce.ts` gives a single already-fetched row the same "unassigned
  is always visible" rule `unitClause` already builds into a list
  query's own `WHERE` clause
- Search and real, server-side pagination (0376), on the operator's
  own observation that a real customer's own count reaches the
  thousands — loading everything and narrowing it in the browser was
  never viable at that scale. Search covers order number, seller VAT,
  and both line-item fields (`item_name` and `item_description`,
  since most real files only ever populate the first); a genuinely new
  seller-name field was identified as missing entirely and deferred by
  the operator's own choice rather than built speculatively. The
  frontend reused `documents.js`'s own established search-box pattern
  (`onchange`, full re-render, explicit re-focus) rather than
  inventing a debounced alternative
- A real status lifecycle (0377), reversing what decision 0372
  deliberately left out ("no Change, no hold, no status") on the
  operator's own request. Active/On-Hold/Closed is a real, assignable
  column — Hold/Release Hold/Close on the pop-out mirror Suppliers'
  own hold mechanism exactly (decision 0230), and an explicit status
  on a CSV re-upload overrides even a closed order, deliberately the
  opposite of Suppliers' own "the flag survives its next load"
  precedent, since the operator's own words were that the ERP is the
  system of truth here. Invoiced (Part)/(Full) are not stored at all —
  derived live via the same `json_extract` pattern the dashboard
  already uses against `facts_json`, no new column on the invoice
  side. The status chart reuses `donutChart()` directly, laid out
  beside the Load card exactly like Suppliers' own status ring, and a
  segment click reuses decision 0376's own list filter rather than a
  new mechanism

### Suppliers — search and pagination, and what it forced the status ring to become (0378)
- Search and real, server-side pagination for Suppliers (0378), in the
  same location as Purchase Orders' own row (0376): below the Load
  card, above the list. Reversed decision 0213's own founding
  assumption that one customer's supplier master always fits in memory
  at once — `handleListSuppliers` now takes `search`/`page`/`pageSize`/
  `status`, with a search clause across the same broad field set
  decision 0222's own supplier picker already searches
- **Forced a fix to two things built on that assumption.** Decision
  0299's own status ring computed its counts by looping over the
  fully-loaded array in the browser, and decision 0259's own
  click-to-filter did the same — both would have silently gone wrong
  the moment the array in memory became only one page. A new,
  dedicated `GET /suppliers/status-counts` endpoint (mirroring decision
  0377's own Purchase Order one) is org-scoped and permission-scoped
  but never page-limited; the list's own status filter moved
  server-side too, using a SQL `CASE` expression that mirrors
  `supplierBucket()`'s own priority order exactly — awaiting the ERP
  first, on hold second — and that now-dead browser function was
  removed rather than left behind as a second copy nothing calls
- **A real bug, found only because a test exercised failure after
  success.** `loadStatusCounts()`, on both this screen and Purchase
  Orders' own (one was written by copying the other), returned early
  on a failed fetch without ever resetting its own counts to `null` —
  a chart that had once loaded real data kept showing it, silently
  stale, after a later, genuine failure. Fixed in both files

### Documents
- R2 storage with jurisdiction support (0013, 0033, 0035)
- One original and one generated rendering per invoice

### The control plane
- Signed ECDSA licence tokens, fail-open cache, bootstrap exception
- One customer, many environments — sandbox and production (0036)
- Self-serve trial signup with a human approval checkpoint (0038)
- Control-plane provisioning: customer, environment, trial licence (0039)
- Staged expiry warnings at 14/7/1 days, then blocking (0040)
- Usage telemetry, per environment, aggregate-only

### The interface
- `vf-ui`, one shared deployment for every customer (0099)
- Sign-in, with the session in an `HttpOnly` cookie the JavaScript
  never sees (0102)
- Task Manager: one list across every stage, ownership as a column,
  actions the server decides (0103, 0104, 0105)
- Validation viewer: the retained original beside the fields it should
  have yielded, with an editable line table (0106, 0109)
- **A document frame that recovers when it loads again** (0380). The
  five-minute signed URL (0073) was recorded in 0123 as making a frame
  "go blank", and a later comment in `viewer.js` claimed a refresh on
  returning to the tab that nothing performed. Measured in Chromium
  before fixing: time passing, scrolling, zooming, hiding and switching
  tabs request nothing; only a frame that *loads again* asks with its
  expired link — and shows `vf-app`'s JSON error. The frame's own `load`
  event is the signal now: any load the viewer did not cause gets a
  fresh URL, for both the Document and XML tabs. A timer or a
  return-to-tab refresh was rejected because it would reload a working
  frame and lose the reader's place in it
- A stated visual direction rather than accumulated choices (0108)
- Branding and translations from D1, so a livery or a language needs no
  deployment (0096, 0107)
- **The retained pages behind a multi-page invoice can be listed and
  fetched** (0381, phase 1 of `docs/design/document-viewer.md`). Checked
  directly first: decision 0068's claim that finalising this flow
  "deletes" the pages is false — nothing in the codebase ever calls
  `delete` on this storage, and every page is still in R2. What was
  actually missing was a way to reach them, because
  `handleFinalisePendingDocument` never links a multi-page-sourced
  invoice into `invoice_documents`. `GET /invoices/:id/pages`, `POST
  /invoices/:id/pages/:n/document-url`, and `GET /document-pages/:token`
  now exist, with their own signed token shape (`mintPageToken` /
  `verifyPageToken`) alongside decision 0073's document token.
- **A real, client-side page renderer draws every document now**
  (0382, phase 2 of `docs/design/document-viewer.md`, the phase the
  design document itself named as the biggest and the one every later
  phase depends on). One thumbnail rail, one zoom, one rotate, shared
  by images and PDFs, replacing the `<img>`/`<iframe>` split the
  Document tab used since decision 0123. `resolvePages()` tells the
  two page shapes apart by asking, not guessing: a multi-page invoice's
  own retained pages (0381) if it has any, otherwise a PDF rasterised
  page by page through a locally vendored pdf.js (no CDN, the same
  choice decision 0124 made for the font) or a single image. **A side
  effect nobody planned separately: this retires decision 0380's whole
  problem.** That frame's stale-link bug could only happen because an
  `<iframe>` is a live connection that reloads; a canvas is pixels
  already drawn, so nothing reloads it and nothing can ask an expired
  token again. Rotate and zoom reset on every open — asked directly,
  decided as a session convenience rather than data worth storing.
- **A hybrid invoice's embedded XML is now its own retained artifact**
  (0383, phase 3 of `docs/design/document-viewer.md`). Migration
  0018's own comment said a Factur-X/ZUGFeRD PDF needs "one 'original'
  row only... no separate rendering needed" — true of what was stored,
  and it meant the embedded XML `pdf-attachment.ts` reads for
  extraction was read once and thrown away. It is retained now as
  `document_type = 'embedded_xml'`, and a hybrid invoice gets an XML
  tab the way a bare-XML invoice already does, rendered the same way
  (0279) because the tab's dispatch was always keyed on content type,
  not document type. Widening the closed `document_type` vocabulary
  from two values to three needed a SQLite table rebuild — `CHECK`
  constraints can't be `ALTER`ed in place — following migration
  0033's exact precedent.
- **Expand opens a real page of this app, not a raw file** (0384,
  phase 4 of `docs/design/document-viewer.md`). `document-window.html`
  carries the whole document panel — the phase 2 renderer, its tabs,
  Timeline/Chat — reached by ordinary same-origin navigation rather
  than decision 0073's `window.open(rawSignedUrl)` on a blank tab.
  0073's signed-URL mechanism itself is unchanged and still mints the
  link for the *bytes*; only the chrome around them changed. **One
  window, never a second one**: a fixed `window.open` name is what the
  browser itself enforces, and opening a different task while a
  pop-out is already showing something else retargets that same
  window rather than opening another — the operator's own answer when
  asked directly (*"there should not be a situation where the user has
  multiple pop-out windows open"*). The embedded card shows a toggled
  placeholder, not a rebuild, while a pop-out is open, and detects the
  pop-out closing by polling `.closed`, since no native close event
  exists for an opener to hear. Reusing `buildDocTabs()` and a new
  `initDocumentWindow()`, both from `viewer.js`, meant the pop-out's
  own page has no second implementation of the panel to drift from the
  embedded one. Required moving every rule of the app's own CSS out of
  `index.html`'s inline `<style>` block into a new `app.css`, since a
  second real page had nowhere else to get the same classes from
  without a copy that would eventually disagree.
- **The document viewer's five-phase plan is complete** (0385, phase
  5 of `docs/design/document-viewer.md`). Checked directly rather than
  assumed that phases 2 and 4 had left anything behind to retire:
  neither had, in behaviour — the old raw-file Expand and the old
  `<img>`/`<iframe>` split have no surviving call site anywhere. One
  real leftover, in the CSS rather than the JS: `.vimage`, styling an
  `<img>` decision 0382 had already stopped creating, removed.
- **The pop-out fills the window rather than floating in it** (0386,
  a follow-on fix to decision 0384). Reported live from a screenshot:
  the card sat centred with a 1100px cap nothing else in this
  stylesheet has, and no height rule stretched it to the window at
  all. Both replaced with a flex chain rather than a second guessed
  height — `.vpreview`'s own `calc(100vh - 300px)` was measured
  against chrome this page doesn't have, and typing a different
  constant here would repeat exactly the mistake decision 0380 warned
  against. Measured in a headless Chromium at two window sizes, not
  just reasoned about, to confirm it actually tracks the window.
- **The Seller and Buyer cards give up three fields and a column**
  (0387). Asked directly for screen real estate: E-address, E-mail and
  Phone are gone from both cards, and `.sellergrid`'s two parallel
  columns (Name/VAT beside Address) became one, in the vertical order
  Name, VAT no, Address. The card got **shorter**, not taller, measured
  in a headless Chromium against the same fixture before and after —
  421px to 263px, because the wrapping the two half-width columns were
  causing (a supplier name across four lines, an email across four
  more) cost more height than stacking three rows ever added back.
  Reported live once the wider card was in front of the operator, a
  second, smaller change to the same record: the address itself moved
  from beneath its own label back to beside it, superseding decision
  0280 (whose reason — a half-width column — no longer holds once
  `.sellergrid` is one column, full width).
- **The process row and Document card join the grid** (0388). Two
  asks, each mocked up with a real headless-Chromium render before
  being built. First: the process chevrons moved from a full-width
  panel above `.columns` into the left column's own grid area, so
  their width matches the Seller/Buyer cards by construction rather
  than by a rule to keep in sync. Second: `#viewer .columns` gained
  named `grid-template-areas` so the Document card's own grid area
  spans exactly the process+parties+header rows — its bottom lands on
  the header card's bottom, pixel-measured at 768.33px for both — and
  Lines now runs full width beneath both columns instead of being
  confined to the left one. The Document card fills its area with the
  same flex chain decision 0386 built for the pop-out, rather than a
  second guessed height. `.columns` itself stays exactly what it was
  for the Sources screen, which shares the class name (decision 0177)
  with an unrelated two-panel layout; every new rule is scoped under
  `#viewer` or a class that exists only on this screen, checked by
  rendering both screens' own use of `.columns` side by side and
  reading `getComputedStyle` back, not assumed safe. The Exceptions
  card is hidden — `.exceptions { display: none; }`, the operator's
  own words, "without removing the code, just the visibility" —
  `exceptionPanel()` and `renderExceptions()` are untouched.

### Customer configuration
- Org units, teams, roles, users, cost centres
- Intake channels
- **Customer-defined fields** — the closed vocabulary becomes closed
  *per customer* rather than globally (0041)

### Roles, org narrowing, and the Roles screen — new this arc (0313–0331)
- **An org switcher** in the topbar: a person holding a role at more
  than one org picks which one they are looking at, and Tasks,
  Documents, Dashboard, and Suppliers all narrow to it (0313–0316).
  Narrowing never grants — choosing an org not held still shows
  nothing.
- **Suppliers get an org**, with per-org ERP identifiers and a
  matching tiebreaker used only when a pay site cannot resolve one on
  its own (0317, with a real capture-time ordering bug fixed in
  0318).
- **A real Roles screen** where every role, org unit, person, role
  assignment, and approval limit had previously existed only as raw
  database rows, reachable only by direct SQL (0319). Read-only at
  first, gated to instance administrators (`Admin.Configure`) with
  scoped visibility for a delegated `Admin.UserManagement` holder
  (0320, 0321).
- **The write side, built as its own, separately-permissioned
  surface**: creating and editing a role's own definition
  (`Admin.RoleManagement`, deliberately not delegable — 0326);
  assigning and revoking a role for a person, mirroring the same
  delegation boundary granting already has (`Admin.UserManagement`,
  deliberately delegable — 0327, the other half of decision 0201);
  creating a person, with the same delegation boundary applied to
  which org a new person can belong to (0328).
- **Two real, live security gaps closed while building this, not
  before**: `handleCreateUser` and `POST /org/users/:id/authority-limits`
  had no permission check of any kind — both flagged as known gaps in
  earlier decisions, both closed here rather than a UI being built on
  top of them (0328).
- **Two new permissions**, each a real gap a live report surfaced:
  `Admin.RuleActivation`, replacing `AP.Approve` as the gate for
  activating a rule — that name implied invoice approval and never
  gated it (0325); `Admin.RoleManagement`, for editing what a role
  itself grants (0326).
- **Every permission's own real description**, shown beside its
  checkbox on the Roles screen, sourced from `permissions.ts`'s own
  comments rather than invented, and kept in the same file as the
  permission it describes so the two can never drift apart (0331).

### Access — the renamed, tabbed screen, teams, and user properties (0332–0348)
- **Teams are real** (0332): `handleUpdateTeam`, `handleRemoveTeamMember`,
  and `handleListTeams` added alongside the two routes that already
  existed, every one gated, and every team belongs to exactly one org
  now (`unit_id NOT NULL` on `org_teams`, migration 0064).
- **Roles renamed Access, restructured into tabs** (0333): Org Units,
  Roles, People, Teams, replacing four sections on one long scroll.
  Org Units and Roles hidden from a delegated administrator holding
  only `Admin.UserManagement`, gated on `Admin.Configure` — never a
  literal role-name check.
- **User properties** (0334): cost centre, manager, address, and a
  derived Budget Holder flag (true if the person owns any cost
  centre, never a stored, independently-settable flag) — plus a real
  spend limit, genuinely distinct from the existing approval limit by
  direction of flow, not the same thing under a second name.
- **Creating and managing an org unit** (0335): `handleCreateUnit`
  already existed, unauthenticated, since decision 0003 — closed here
  rather than built around. `handleUpdateUnit` built new; nothing let
  an existing unit be edited before this.
- **The org list is a real tree** (0336): `sortUnitsAsTree` — a child
  immediately beneath its own parent, alphabetical among siblings at
  every level — replacing a flat `ORDER BY kind DESC, name ASC` that
  never actually grouped a child beneath its own parent at all,
  despite the screen's own indentation implying it always had.
- **Role allocation and property assignment split back into two
  pop-outs** (0337), each reached by its own icon in the row (0338
  moved those icons into their own columns, once stacking an icon
  beneath a cell's own text grew every row too tall) — reported live
  as *"not very user friendly"* when 0334 first combined them.
- **The approval and spend limit currency fields are a closed
  dropdown** (0339), corrected to the real, researched Peppol BIS
  Billing 3.0 / ISO 4217 list (0340), then filtered to the 156 of
  those 178 codes a company can actually purchase with — precious
  metals, bond-market units, and ISO 4217's own "funds" excluded
  (0342) — with the field's own width fixed twice more along the way
  (0341, 0343, 0344). A real `<hr>` now sits between a person's own
  properties and their limits (0345).
- **Parent Org and Tax Identifier, now shown in the Org Units table
  itself** (0379), not only inside the edit form that already read
  both. The parent shown by its own name, looked up the same way
  `unitDepth()` already walks one link of the same chain for
  indentation — a dash, not a raw id or a blank cell, for a unit with
  no parent. The recorded title "VAT ID" renamed to "Tax Identifier"
  throughout, one string read by both the table's new column and the
  form's own label.
- **The side nav is grouped under three static headings** (0346):
  Accounts payable, Supplier management, Configuration — distinct
  from the single, collapsible "Vibe AP" folder decision 0274 built
  and 0276 reverted; nothing here expands or collapses, and a heading
  with nothing unlocked beneath it is never shown.
- **Sources gained icons on Rename, Retire, and a repositioned Create
  action** (0347), and Rename/Retire's own confirmations are real,
  in-app pop-outs now rather than native browser dialogs, which could
  never be made to look like part of this app regardless of styling
  (0348).

---

## Not built

**~~Infrastructure provisioning.~~ Built** (0135, 0136).
`migrations/provision_infrastructure.py` creates the D1 database,
applies the migration chain, creates the R2 bucket, verifies the
manifest, deploys the Worker from a config the control plane supplies,
and records the URL last.

**A script the operator runs, not a route.** The token can delete every
customer's database and replace any Worker, and `vf-licence` is
internet-reachable — so a flaw in any route would become total account
compromise.

**~~Email Routing rules.~~ Done, by hand.** A rule delivers to `vf-app`
and **real invoices arrive by email**. Creating rules through the API,
per source rather than per customer, is still not built — so a second
source means a second visit to the dashboard.

**The whole organisational model is scoped** (0192 onwards). Legal
entities and operating units were already Oracle's and SAP's own shape
(0194); what has been added is a **ledger** — their accounting frame —
with cost centres beneath it carrying an owner and a limit (0195), rule
sets and field visibility per unit (0196, 0197), and roles held **in an
org** rather than everywhere (0199), with delegated administration
bounded above as well as below (0201).

**Still not a full boundary**: twelve of fourteen permission checks ask
*"at all"* rather than *"where"*. Claiming, completing, the task list
and the document list are scoped; keying, approving and returning are
not.

**Teams have no org-scoping in the task-queue sense.** Every team now
belongs to exactly one org for administration purposes (`org_teams.unit_id`,
0332); task assignment still names a team by id directly, with
nothing narrowing which teams a given screen offers based on the org
a task or document belongs to.

**Rules and Sources as further Access tabs** were discussed and
deliberately scoped out of 0333 — Org Units, Roles, People, and Teams
are the four tabs today.

**The remaining "user variable" fields that are genuinely new
schema**: a picture (no image storage exists for anything
user-related), a forename/surname split (today a single `name`
field), and a business title. Cost-centre allocation *for a person*
is built now (0334) — the field this note used to name as missing.

**The operator interface's screen** (0140). The attribution half is
built — every privileged action recorded, refusals included. The screen
is unblocked and unwritten.

**~~Publishing a process version~~ Built** (0349). Decisions 0150 and
0160 built the foundation and said *"nothing creates a v2"*; decision
0349 finished it, and this entry went on listing it as half a feature
until decision 0380 noticed.

**Per-line VAT extraction.** `BT-151` and `BT-152` are in the
vocabulary and nothing fills them, so the derived VAT and total columns
an operator asked for would be empty on every row (0171). Several other
line columns are blank on every real document for the same reason.

**Measured pagination and annotation** (0206). Both need to know where
things are inside a rendered document, and both need same-origin
delivery first — the operator chose to do them together rather than
build pagination with a mechanism annotation would replace.

**Coding — where a line is charged.** `invoice_lines.cost_centre` has
existed since 0007 and `BT-133` since 0031, and **nothing assigns one**
(0225, 0226). The largest gap, and the one the operator's own correction
pointed at.

**The supplier fields nothing reads.** Terms, hold, match option and
tolerances load and display, and **no process consults any of them**
(0211, 0218, 0219).

**A screen for unplaced documents.** `org.unplaced` records *why* an
invoice could not be placed and nothing reads it (0204) — so a queue
could build up invisibly. **Decision 0162's own shape, for the fourth
time.**

**Downscaling a large image.** A 936KB photograph exceeds what the
model can do in the time available (0163). It is kept and explained
rather than lost, and it is not read — nothing resizes, retries or
splits it.

**Image-only PDFs.** A PDF cannot be rasterised inside a Worker — no
native renderer, and PDF.js needs a canvas workerd does not provide.
Submit the page as an image instead.

**Abandoned pending documents.** A page-one upload that never returns
holds a customer's invoice image indefinitely. Needs an expiry sweep,
or at minimum a way to list stale ones.

**Capture rules.** Rules changing what the model is *asked for*, before
extraction. Distinct from mapping rules (0058), which run on facts and
need no new machinery — this half remains designed only, and has an
ordering problem: a condition testing the supplier needs extraction to
have happened first.

**Despatch Advice (T16).** The goods receipt, and the missing third leg
of three-way matching — `permissions.ts` has always described `AP.Match`
as a three-way match against PO and goods receipt, and two thirds of
that data does not exist (0082). Decision 0082 recorded three-way
matching as the confirmed target, so this — not a bigger two-way
matcher — is the next piece.

**Document-type detection.** The cascade answers "what structure is
this", not "what document is this", so the XML branch assumes an
invoice and a valid Peppol Order sent to capture is refused. Peppol
supplies the discriminator in `cbc:CustomizationID`, which nothing
reads (0082).

**Bulk order loading.** One document per request today. Enough to prove
the shape, not enough for a real customer with an ERP.

**`party.first_document`.** Declared and uncomputed (0079). Closer than
the `po.*` pair — the data exists — but needs three questions settled
first, including that it must be computed at capture and stored, or
re-running a rule set could yield a different answer and break the
reproducibility property the interpreter rests on.

**`org_units` is now connected** (0111). An invoice acquires an
operating unit at intake — from a rule the customer wrote, or from the
source it arrived through — and a stage can refuse to let it past
without one. What remains unconnected is any **user** or **process**
scoping, and there is still no interface for placing one by hand.

**The supplier master.** Now has a reason and a shape: decision 0117
spawns records from captured documents, so the master is populated by
using the product rather than by typing five hundred suppliers before
anything works. Today `/suppliers/:vatId/history` queries invoices by
the VAT identifier printed on them, so a supplier is a string that
appears on documents rather than a record. **Supplier sites assigned to
operating units** — how a supplier's invoices reach the right part of
the enterprise — are what "supplier groups" below has always been
waiting for, and they follow the org model (0111) rather than leading
it.

**Supplier groups.** Needed for conditions like *"if the invoice is
from a transport provider"*, which should be a lookup against
configuration, never a model inference. Now also the missing condition
for mapping rules (0058).

**Export and purge.** A retention period is configurable and a report
lists what has passed it (0077), but nothing exports or deletes. Export
must come first and be verified before anything deletes. Per-
jurisdiction periods are the other known gap: one number cannot express
"seven years in Germany, five in the UK".

**Advancing after keying.** Keying reports whether the document would
now validate (0072), but the instance sits where it was until its task
is completed — so "key" and "finish the task" are two actions where a
person might expect one. Whether task completion should carry keyed
facts into a re-evaluation is 0064's territory: `onTaskCompleted`
advances by sequence without evaluating rules, so it has nowhere to put
them.

**Mapping rules.** Customer-authored rules deciding which extracted
value lands in which field — *"use the transport reference as the
invoice number"* (0058). The machinery exists; what is missing is the
vocabulary's EN 16931 reference fields and supplier groups.

**Line-level extraction.** Extracted from images since 0044's addendum;
still absent from the UBL parser's allowance and charge groups.

**Self-service password reset.** Needs email, and nothing here sends
any. **An account is recoverable today** — an administrator sets a
password directly — which is workable for one customer and a support
queue for twenty. An
administrator setting a password directly is the only reset available
(0089).

**Alerting on failed sign-ins.** Attempts are recorded and queryable;
nobody is told. "A lockout policy that generates no alert is half a
control" (0090, 0094). The constraint that
shapes it: **Workers cap PBKDF2 at 100,000 iterations** where OWASP's
minimum for PBKDF2-SHA256 is 600,000, so native Web Crypto cannot meet
guidance. Argon2id via `@noble/hashes` runs at OWASP baseline
parameters in 321 ms, measured. Beyond hashing it needs rate limiting,
lockout and reset — and reset needs email, which does not exist.

**Email.** Nothing is sent on approval, expiry warning, or expiry.
The operator emails people personally.

**Billing.** The payment webhook and the consumption-based pricing
model.

**Sandbox to production.** Converting a trial sandbox into a paid
production environment, and migrating configuration between them.

---

## Known uncertainties

Things that are built but not proven, kept separate from things that
are simply absent.

**One layer disagreeing with another is the recurring bug.** Six
instances so far: `invoice_lines.cost_centre` was a column with no
vocabulary entry; `extraction.confidence` was set as a fact and never
declared, so the rules meant to use it could not be written (0054);
decision 0053 shipped settings that reached nothing (0056, 0057); the
UBL parser populated 11 of 21 declared fields, so validation's
arithmetic checks could never run on the most trustworthy path (0059);
`CIUS_PROFILES` claimed FatturaPA is a CIUS when the codebase's own
description said otherwise (0065); a whole document-storage layer
existed that nothing on the capture path called (0068); a content type
was derived from half a detection result (0069); a migration
checksum was written on every apply and compared to nothing, under a
comment asserting it was verified (0076); a keying screen filled a
line's convenience *columns* and left its *facts* empty, so a keyed
line would have been invisible to every line-scoped rule (0109); **four
of the six mandatory elements of `cac:InvoiceLine` were missing from the
closed vocabulary**, including the unit of measure that makes a
quantity mean anything (0110); and, checked while scoping the document
viewer's next piece of work, decision 0068's own later claim that the
multi-page flow "deletes on finalise" against a codebase with no
`delete` call anywhere on that path (0381) — the record was wrong about
its own subject a second time, in the opposite direction from the first;
and, widening the same table's `document_type` to a third value,
`invoice-facts-route.ts`'s own ad-hoc `ORDER BY uploaded_at DESC LIMIT
1` query disagreed with `preferredDocumentType()`'s real ranking the
moment a row of that type existed (0383) — the two had only ever agreed
by coincidence, because every type inserted after `'original'` happened,
until then, to also be the preferred one.
**None was found by reading either layer alone**, and several were
found by a question rather than by any test. Decision 0067 now makes one
of these a standing test: for every declared field, either the UBL
parser populates it or the check file records why not — so a gap has to
be *stated* to be allowed.

**Declared and implemented nowhere is the second pattern.** `'warned'`,
`validation.passed`, `extraction.confidence`, `set_field` and
`require_second_approval` were all in the vocabulary before they did
anything. The first four were later built; the fifth was **removed**
(0074), because parallel tasks, a rule at Review and RBAC between them
already covered everything it might have meant.

An action in the closed vocabulary is a promise to the compiler. A
customer writing *"invoices over 10,000 require a second approval"* got
a rule that compiled, activated, fired, and did nothing — while looking
correct in every listing. A refusal at compile time would have told them
to express it differently; silence told them it worked.

**Every extraction decision comes from a sample of one.** A single
German freight invoice, with an unusual two-page structure, drove the
line cap, the conflict-resolution rules, the tolerance, the
description requirement, and the one-call-per-page architecture. None
is wrong today; all are inferences from one document, and several
belong in per-customer configuration rather than platform code.
Decision 0052 lists them explicitly and should be revisited against a
real control set.

**A prompt cannot be verified by unit tests.** Tests can assert that
a prompt contains a phrase; only a live run shows how a model behaves
given it. A page-note change that read as restrictive suppressed a
line table entirely while every test passed. Prompt changes need a
live check before shipping.

**A prompt instruction is not a safety property.** The extraction
prompt forbids calculation outright, and on a real document the model
calculated anyway — reporting a total printed nowhere on the page,
contradicting its own extracted lines. The same instruction held on a
different scan of the same page. Compliance is inconsistent, not
absent, which is harder to design around. Validation caught it;
nothing that matters should rest on an instruction alone.

**The extraction confidence score may mean nothing.** It reported
`0.9` while the model was receiving no image at all, and `1.0` on a
genuinely correct extraction. The design routes low-confidence
extractions to human review; nothing yet demonstrates the number
carries information. Test with a deliberately poor photograph before
relying on it.

**Vision extraction has been verified against exactly one invoice.**
It read every field correctly, including an ambiguous date format
resolved from context. One document is not a sample.

**Three pre-existing test failures in `shared/`**, none related to any
recent work. Two are time-expired JWT keys in
`shared/licensing/token.test.ts`, failing on `main` since before this
session. The third,
`shared/migration/table-classes.test.ts`, "names each one exactly
once" — reports six tables, not the four first found on 15 September,
never classified into `CONFIGURATION_TABLES` or
`NON_MIGRATING_TABLES`: `_supplier_links`, `dashboard_cards`,
`dashboard_cards_new`, `document_comments`, `org_spend_limits`,
`org_teams_new`. The last two are new to this count — added by
decisions 0334 and 0333 respectively, before this session, and never
classified either. Decision 0118's own standing question — does this
table hold what a customer configured, or what their instance did —
was never answered for any of the six. A real fix, still not done.

**The `vf-ui` browser suite exits 1 while every test passes** (found
in 0380). `vitest` catches 136 unhandled rejections — the same number
before and after that change — and fails the run. Nearly all are test
fetch stubs refusing an unstubbed request made by work the viewer does
not await: the activity feed (decision 0326 saw one that "occasionally
surfaces"; it surfaces every run) and the document preview. The counts
below are tests passing, not a clean exit. A real fix, not done.

**`compiler-model.ts` has a response-reader ordering that was a real
bug in the extraction path.** It works correctly against
`gpt-oss-120b` and has all session. Left alone deliberately: changing
working code on a theory is the mistake that cost six attempts
elsewhere.

---

## Test counts

| Package | Tests |
|---|---|
| `vf-app` | 1921 |
| `vf-licence` | 320 |
| `vf-ui` | 74 Worker · 653 browser |
| `shared` | 278 passing, 3 known pre-existing failures |

Both migration chains replay clean with every standing invariant
holding — 70 migrations for `vf-app`, 119 for `vf-licence`.

**`vf-app`'s count was recorded as 1851 through decision 0379**; a clean
run at `46c1da2`, with no `vf-app` change since decision 0378 recorded
1851, counts 1893. Why the two differ is not established — recorded as
measured (0380) rather than explained after the fact.

---

## Documentation

| Document | Covers | Currency |
|---|---|---|
| Design Document 1 | Scaffolding | Not reviewed recently |
| Design Document 2 | Compiler & rule engine | Updated for 0041 |
| Design Document 3 | Licensing & control plane | Updated through 0040 |
| Design Document 4 | Source and intake | Current |
| `docs/design/extraction.md` | Extraction, with build record | Current |
| `docs/design/operator-interface.md` | The screens, and what blocks them | Current |
| `docs/design/mockups/` | Four screens as static HTML | Current |
| `docs/design/multi-authority-intake.md` | Non-EN-16931 authorities | Design only |
| `docs/design/text-layer-extraction.md` | Reading a PDF's own text | Design only |
| `docs/decisions/` | 383 decision records | Current |
| `docs/decisions/SUPERSEDED.md` | Which records supersede which | **Read first** |

Document 4's markdown source is at `docs/documents/`, with
`scripts/build-document-04.cjs` rendering the Word edition. The `.docx`
is deliberately not committed: a binary that cannot be diffed would
break the traceability the rest of `docs/` depends on.

**Not written**: a customer-facing API guide, a document on the
workflow engine, and a document on the interface. Documents 1, 2 and 3
predate `vf-ui` entirely.

**And a warning about the decision records themselves.** They are never
rewritten to agree with later ones — what was decided, and why it looked
right at the time, is part of why the current answer is what it is.

**So contradictions between records are real, and neither is wrong.**
They are dated. `docs/decisions/SUPERSEDED.md` is the map, and it exists
because the trap has been fallen into twice: decision 0094's conclusion
sat in the handover's *resolved* list as settled for days after 0117
corrected it, and two of 0089's open items were closed by 0090 on the
same day and went on reading as open.

---

## Working notes

Two habits have repeatedly earned their place, and one lesson was
learned expensively.

**A Worker cannot plain-`fetch()` another Worker's `workers.dev` URL.**
Found live in August (0005) and again in September (0102): Cloudflare's
anti-loop protection answers with a 404 the target never sees, reported
as `error code: 1042`. Use a Service Binding for a fixed target, or the
`global_fetch_strictly_public` flag where the target varies per
customer. **The decision record existed and was not consulted before
writing the same bug.**

**Running a check and reading it are different acts.** `npm run lint |
tail -1` printed a blank line whether lint passed or failed, so three
real violations were reported as clean for several decisions (0100).
**Check the exit code.**

**Test the wiring, not just the part.** A session helper was tested and
worked; nothing tested which routes called it, so claiming a task
accepted only API keys and 927 tests passed while the button did
nothing (0105). Seventh instance of a real mechanism pointing somewhere
other than the question being asked.

**A guard is only a guard where it runs.** Three write routes in
`vf-licence` were listed in `isAdminRoute` and returned before it was
evaluated — a complete authentication bypass, found by an operator
testing a placeholder key (0097). Every one had tests, all calling the
handler directly, which says nothing about whether the router protects
it. **Exercise the real path, not the piece you believe is on it.**

**A route existing in the backend proves nothing about whether a
browser can reach it.** `vf-ui` forwards `/api/*` to `vf-app` only for
paths on its own explicit allow-list — a second gate, entirely
separate from anything `vf-app` itself checks. Found six times in one
arc (0212, 0324, and four more in 0326–0328): `/org/overview`,
`/org/roles` (both create and the later update route), `/org/users/:id/roles`
(both assign and revoke), `/org/users`, and
`/org/users/:id/authority-limits` had all existed and been tested in
`vf-app` — some since decision 0201, months earlier — and had simply
never been reachable from a real browser at all. Decision 0212 built
a test list (`reachable`, in `vf-ui/test/index.test.ts`) for exactly
this failure mode after the first two instances; every later instance
was still found by a live request failing, not by that list, because
the new route was never added to it either. **Adding a route to the
backend and adding it to this list are two separate steps, and
nothing yet ties them together.**

**A standing invariant detects; it does not prevent.** Decision 0092
claimed one meant a cross-customer grant could not be written. A
hand-written INSERT then wrote one against the live control plane
(0093). Where a rule spans tables and matters, carry the discriminator
and use composite foreign keys — prevention that is visible in the
schema and survives a rebuild.

**A standing invariant written as a hand-copied SQL literal drifts the
moment its own source of truth grows.** `permissions.ts`'s own closed
vocabulary is checked against a SQL migration's hand-written
enumeration (decision 0200, migration 0048) — and adding a single new
permission (`Admin.RuleActivation`, 0325; `Admin.RoleManagement`,
0326) broke this test both times, exactly as designed. The fix is not
to edit an already-applied migration — a new one restates the same
invariant with the vocabulary as it now stands, and the test comparing
the two reads every migration in the chain together. **A closed
vocabulary checked in two places will drift in exactly the place
nobody is looking when the first one grows.**

**A survival test cannot catch a broken reference.** Rebuilding a
referenced table (0084) passed a check that existing rows survived, and
shipped a schema where every NEW child row failed — because SQLite had
rewritten the foreign key to follow the renamed parent, and the rows
being checked were copied before it moved. **Insert after a migration,
not just count.**

**Watch every new check fail.** A test nobody has seen fail is a
comment that takes time to run. Several real bugs this session were
caught only because the check was deliberately broken first — and one
test was found to be hollow that way, then corrected rather than left
overstating itself.

**Refuse rather than approximate.** It runs through the compiler, the
interpreter, extraction, and the type system. A field that cannot be
read is absent, never invented. A rule that cannot be expressed is
refused, never approximated.

**Report what happened, not just that it happened.** A caller told only
that an operation succeeded cannot see *how* it succeeded. Decision
0068's `retained: true` was accurate while the document was being stored
under the wrong content type, and only a database query revealed it
(0069, 0070). The response now names the type and key, so the next
mistake of that kind is visible where somebody is already looking.

**Instrument the boundary with the real payload.** Learned the hard
way over six attempts at one bug. A diagnostic that tests a
*simplified* version of a failing request will confirm every
component works while the real request keeps failing. Send exactly
what production sends, and print exactly what comes back.

**Check one layer against another.** The five divergences above were
all found this way and none any other way. Storage proves nothing about
addressability; an admin route proves nothing about effect; a field
declared in a vocabulary proves nothing about a parser populating it.
The test has to cross the boundary — a unit test that hands a
dependency to the unit proves the unit, never the wiring.

**Measure the premise before building the fix.** Decision 0123 wrote
that a frame with an expired link "goes blank", and a later comment
claimed a refresh on returning to the tab. Neither had been watched.
Measured, time alone broke nothing, and the fix both implied — reload on
return — would have thrown away somebody's place in a document that was
still showing (0380). **A comment claiming a fix is not a fix, and a
record describing a failure is not a measurement of one.**

**Draw the interface earlier than feels necessary.** Mocking up screens
that nobody had asked to be built found a hard blocker — captured
documents are not stored at all — and three workflow-engine gaps that
reading the code had not surfaced. A rail showing *"1 of 2 tasks, held
here until both are done"* invited an obvious question, and the answer
was narrower than anyone had assumed.
