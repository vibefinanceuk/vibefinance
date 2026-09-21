# VibeFinance — Progress and Status

Last updated 20 September 2026. A living document: what is built, what
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
- `assign_task`'s `"team"` and `route_to`'s `"stage"` now resolve
  against the real `org_teams`/`process_stages` list injected into
  every compile — the compiler used to have nothing to check a
  sentence's team or stage mention against, and both its own worked
  example and, without real data, the model itself would echo the
  sentence's words back rather than resolve them, which
  `task-route.ts`/`workflow-engine.ts` then failed on invisibly (0402)

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
- **Exceptions by Supplier and Task Aging Report now drill through to
  Documents** (0411), the same pattern `where_things_are` already had:
  a supplier's own bar filters Documents to that supplier's own name —
  the exact expression `exceptionsBySupplier()` groups by, with the
  same 30-day/failed-validation condition, not a second definition of
  "an exception" — and an aging bucket's own bar filters Documents to
  that bucket's own day range, carried from `ageing()`'s own response
  rather than re-decided in `documents-route.ts`. Neither `barChart`
  nor `barList` had a click before this; added directly to the bar
  itself, unlike the donut's own legend-is-the-target workaround
  (0264) for a click target too thin to hit reliably. In the same
  commit: `documents-route.ts`'s own `duplicates=1` click-through had
  the identical never-persisted-`facts_json`-key bug 0410 fixed on the
  Possible Duplicates tile's own count, still broken because 0410
  never touched this route — now reads the real `duplicate_confidence`
  column too.
- **Two empty cards, two different root causes** (0410). Possible
  Duplicates counted a `facts_json` key that's never actually stored
  — the score lives only in its own column, and the key existed only
  in memory, synthesised for a different route — so the card always
  read zero regardless of real, correctly-scored duplicates; fixed to
  read the column. My Priority Tasks was not a bug: it has always
  deliberately excluded a team's unclaimed queue (0180), but 0401's
  rename to that title, in the same change that deleted its own
  clarifying subtitle, left nothing on screen to say so; the operator
  chose to restore the subtitle rather than change the scope.
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

### The Workload screen — team throughput, the first real slice of the Management Dashboard design (0415)
- **`AP.Analysis` reads something for the first time.** Reserved in
  `permissions.ts` since before this arc, described until now as "no
  screen shows it yet" — a real, gated route
  (`workers/vf-app/src/workload-route.ts`, `GET
  /workload/throughput`) and a real screen
  (`workers/vf-ui/public/workload.js`) both exist now, scoped the same
  way every other analysis card already is.
- **One chart, not the whole five-screen design.** The Management
  Dashboard research/design deliverable (a Claude Docs document and
  Design-canvas mock-ups, not this repo) sketched five screens —
  Supplier Performance, User & Team Workload, Fraud & Risk Detection,
  Liabilities & Accruals, Multi-Enterprise CFO View. This is the one
  vertical slice built for real: "Throughput by user, stacked by
  stage," chosen because it needed no new permission and no new
  scoping concept. The other four stay design-only — see "Not built."
- **A real stage count, folded onto a fixed chart budget, without
  hardcoding either number.** `tokens.css` caps categorical chart
  colours at 5; the real seeded `ap-live` process has 7 stages;
  `process_stages` is customer-configurable data (0008), so neither
  count can be assumed. A stage's own `sequence` maps positionally
  onto one of 5 buckets (`bucketOf()`), reproducing the operator's own
  chosen merge (Matching+Coding, Review+Payment-eligible) for
  `ap-live` specifically, while staying correct for any other
  customer's own stage count.
- **`charts.js` gains its first multi-series chart** (`stackedBarChart`)
  and a standalone legend (`chartLegend`), colour-per-segment rather
  than colour-by-array-position — two rows with different subsets of
  the same 5 buckets would otherwise draw the same bucket in two
  different colours. See decision 0415 for the real ordering bug this
  caught along the way (a legend label built from SQL row order rather
  than process sequence).

### The Supplier Performance screen — spend by supplier, the second real slice of the Management Dashboard design (0416)
- **A second screen, `AP.Supplier` reused rather than a new
  permission.** The design's own choice: scoped exactly the way the
  existing Suppliers screen already is (`unitsWherePermitted`
  intersected on the supplier's own org unit, decision 0358) — a real,
  gated route (`workers/vf-app/src/supplier-performance-route.ts`,
  `GET /suppliers/spend`) and a real screen
  (`workers/vf-ui/public/supplier-performance.js`).
- **One metric of seven.** "Spend by supplier, with a top-N ranking" —
  the design's own second bullet under this screen's key metrics —
  because `invoice_headers.total_with_vat` and `suppliers.org_unit_id`
  already exist and needed no new plumbing. The other six (cycle time,
  exception rate, PO variance, payment terms, early-payment capture,
  hold history) stay unbuilt — see "Not built."
- **Never summed across currencies.** Real invoices here are genuinely
  multi-currency (GBP, EUR and USD all appear in this project's own
  test fixtures) and nothing in this codebase converts between them —
  every existing screen that shows a monetary figure pairs it with its
  own currency and never adds two together. Asked directly rather than
  assumed: spend is grouped by `(supplier, currency)`, and the route
  hands back one ranked top-N list per currency actually present
  rather than one blended total nobody could trust. A customer whose
  suppliers all invoice in one currency — the common case — sees
  exactly the single simple list the design asked for; a genuinely
  multi-currency customer sees one list per currency instead.
- **`charts.js`'s `barList` gains an optional `display` field** — the
  figure shown beside a label when the raw value a caller sorts and
  sizes bars by (a plain number) is not what a reader should see
  (money, formatted). Additive: no existing caller passes it, so every
  row it already drew is unchanged.
- **The proxy allow-list lesson from decision 0415 held.** `/suppliers/spend`
  needed no new entry in `vf-ui`'s `PROXIED_TO_INSTANCE` — it already
  matches the existing `/^\/suppliers\/[^/]+$/` wildcard — confirmed
  directly with a regression test in `test/index.test.ts`'s own
  decision-0131 block rather than assumed from the pattern alone.

### AP Analytics — one tabbed screen for the whole Management Dashboard design, permission-gated per tab (0417)
- **Workload and Supplier Performance folded in, not duplicated.**
  Both lose their own standalone nav item; their `open()` entry points
  are gone, replaced by the `load()`/`renderCard()` pair each already
  exported, now called directly by the new tab shell
  (`workers/vf-ui/public/ap-analytics.js`). No route, chart, or
  currency-safe behaviour either screen already had changed — only
  what assembled a full page around each one did.
- **All five of the design's own screens have a tab now, four of them
  real.** Operational Performance (Workload), Financial Performance
  (two real metrics — decision 0418's accruals report and decision
  0419's spend under management), Supplier Performance, and now Fraud
  Prevention (decision 0420's own potential-duplicate-invoices table)
  reuse the real, tested routes 0415–0420 built respectively. Only
  Executive IQ (the Multi-Enterprise CFO View) still renders a plain
  "not built yet" placeholder — still gated on its own real
  permission, so who can even see the tab exists is correct today,
  ahead of what is behind it.
- **A tab's own permission always matches its own route's own gate,
  not the design document's original two-permission-per-screen
  proposal.** Gating a tab more strictly than the data behind it would
  let a person reach that data through the API the tab itself hid from
  them, or the reverse — see decision 0417 for the full reasoning.
- **`AP.FraudReview`, a new reserved permission**, granted by no
  migration — the same standing `AP.Analysis` itself held until
  decision 0415 gave it something real to gate. Adding it to
  `permissions.ts` alone failed `stage-permissions.test.ts`'s standing
  closed-set check on the first full run — a hand-restated permission
  list spread across several migrations has to stay in lockstep with
  the code, and does, because the test catches it when it doesn't.
  Fixed with a new migration
  (`migrations/0071_ap_fraud_review_permission.sql`), the same way
  decision 0350's own `Supplier.Maintain` addition was. **Its first
  real consumer is decision 0420's own duplicate-invoices route** —
  see below.
- **Executive IQ's second gate reuses `me.holdsEverywhere`**, exported
  from `tasks.js` for the first time (`orgPicker()` already read it
  off `me` since decision 0313) — a consolidated cross-entity view is
  more sensitive than any single org-scoped permission alone, the
  design document's own reasoning for the eventual CFO View.
- **The nav's own `AP.Supplier` OR-gate**: `apanalytics` is unlocked by
  any one of `AP.Analysis`, `AP.Supplier`, or `AP.FraudReview` — so
  the nav item appears the moment any real content behind it does,
  without needing every one of the three.

### The accruals report — Financial Performance's first real metric (0418)
- **A liability is an invoice not yet at its own process's final
  stage.** `workers/vf-app/src/accruals-route.ts` (`GET /accruals`)
  reads `process_instances` still `in_progress`, scoped by
  `AP.Analysis` like the rest of the tab, and excludes any invoice
  sitting at its own process's last ("payment-eligible") stage — the
  design's own definition: reaching that stage means readiness to pay,
  which has stopped being merely accrued. The final stage is computed
  per process (`MAX(sequence)`, the same concept `workload-route.ts`'s
  own bucketing already reads for a different reason), never assumed
  from `ap-live`'s own 7-stage shape.
- **One metric of six.** The design's own first bullet under
  Liabilities & Accruals — see "Spend under management" below for the
  second. The remaining four (early-payment/discount eligibility,
  cash-flow forecast, payment terms held vs. actual, and DPO) stay
  unbuilt; three of them need payment-execution data (when and on what
  terms an invoice was actually paid) this codebase does not capture
  anywhere — see "Not built."
- **Never summed across currencies, broken out by stage in process
  order.** Grouped by `(currency, stage)`, the same currency-safety
  discipline decision 0416 established — but ordered earliest-stage-
  first rather than ranked by size, since a liability reads naturally
  as the money's own path through the process, not "biggest first."
  **Always shows its own total, even for the ordinary single-currency
  case** — a real difference from Supplier Performance's own bare
  currency label, since the accrued total here is the report's own
  headline figure (the design's own "stat tile"), not merely a
  disambiguation.
- **The proxy allow-list checked and fixed immediately this time**,
  not after a live report: `/accruals` matched no existing wildcard,
  so it got a real new entry on `vf-ui`'s `PROXIED_TO_INSTANCE`
  alongside the route itself, proven reachable by a regression test in
  the same change.

### Spend under management (with PO) vs. total spend — Financial Performance's second real metric (0419)
- **"With PO" means the invoice's own BT-13 resolves to a real
  purchase order — not `po.matched`.** `po.matched` (`po-matching.ts`)
  is a price/quantity-tolerance verdict; "spend under management" is a
  procurement-governance question instead — did the invoice go through
  the controlled PO process at all. `workers/vf-app/src/spend-under-
  management-route.ts` (`GET /spend/under-management`) left-joins
  `invoice_headers` to `purchase_orders` on `json_extract(facts_json,
  '$."BT-13"')`, the same field-without-a-column pattern
  `purchase-order-route.ts`'s own `INVOICED_AMOUNTS_JOIN` already
  established. An order named but never stored here does not count —
  the same "nothing to check against yet" reasoning `po-matching.ts`'s
  own header-level match already gives for a different question.
- **Not this metric's own listed primary screen.** The design's own
  catalog lists the Multi-Enterprise CFO View (Executive IQ) as the
  primary screen for this report; the design is explicit that such
  cross-listing is deliberate. Executive IQ does not exist yet (needs
  a real multi-org scoping concept), so this was built on Screen 4's
  own listing instead — the same "one real vertical slice" discipline
  every Financial Performance metric has followed. When Executive IQ
  is eventually built, this metric likely belongs there too.
- **A different visualization shape from Accruals, honestly.** The
  design's own suggestion here is "Stat tile, % of total spend" — a
  genuinely different shape from Accruals' "stat tile + table broken
  out by stage" — so the UI reuses `charts.js`'s own `donut()`, the
  single-proportion ring, previously exported but unused anywhere.
  Financial Performance now renders two real cards, not one;
  `ap-analytics.js`'s own `tabContent()` loads both and the two fail
  independently, so one's own load error never hides the other's real
  content.
- **The proxy allow-list checked directly again**: `/spend/under-
  management` matched no existing wildcard either, so it got a real
  new entry, the same discipline decision 0418 already established.

### Potential duplicate invoices — Fraud Prevention's first real metric (0420)
- **Not a new detection system — a fuller view of data already
  captured**, the design's own explicit framing.
  `workers/vf-app/src/fraud-duplicates-route.ts` (`GET
  /fraud/duplicates`) reads `invoice_headers.duplicate_confidence`
  (decision 0028), the same column and the same `>= 0.5` threshold the
  Dashboard's own `possible_duplicates` card already uses, so the two
  screens never disagree about "how many duplicates."
- **A table of flagged invoices, not matched pairs — the schema's own
  honest limit.** `duplicate_confidence` is a scalar stored on the
  invoice that was scored; which other invoice(s) it was scored
  against is never itself persisted (`findSimilarInvoices()` returns
  candidates for scoring, not a stored match). So this answers "which
  invoices look like duplicates, how confident," sorted by confidence
  (the design's own suggested visualization) — not "invoice A is a
  duplicate of invoice B."
- **`AP.FraudReview`'s first real consumer** — reserved since decision
  0417, the same "described as unused" precedent `AP.Analysis` itself
  set before decision 0415. `permissions.ts`'s own description string
  updated to match.
- **A plain data table, not a chart** — reuses `.tablewrap`/`table`,
  the same shape `purchase-orders.js`, `documents.js`, and
  `suppliers.js` already build, since the design's own suggested
  visualization here is literally a sorted table.
- Fraud Prevention is now the fourth of AP Analytics' five tabs to be
  real; only Executive IQ remains a placeholder. The proxy allow-list
  checked directly again: `/fraud/duplicates` matched no existing
  wildcard either.

### Unapproved-supplier invoices — Fraud Prevention's second real metric (0422)
- **Two different risks, told apart, not blurred into one flag.**
  `workers/vf-app/src/fraud-unapproved-suppliers-route.ts` (`GET
  /fraud/unapproved-suppliers`) returns invoices that either name no
  supplier this system recognises, or name one that is on hold today
  — each row carries its own `reason` (`"notonfile"` or `"onhold"`) so
  a reviewer is never left guessing which.
- **"Not on file" reuses a column that was already reliable — checked
  directly, not assumed.** `matchSupplier()` (`match-supplier.ts`) is
  the only place a supplier is ever named to an invoice, and
  `source-capture-route.ts` only sets `invoice_headers.supplier_id`
  when it succeeds — a null column is a fully sufficient proxy for
  "matched nothing," across all three of that function's own failure
  reasons, confirmed by reading the write path itself.
- **"On hold" is read live from `suppliers.on_hold`, deliberately not
  the frozen `supplier.onHold` fact captured once at invoice arrival.**
  Decision 0231 froze that fact on purpose, for automated rule
  evaluation at the moment a document arrived. This is a review
  screen, not a rule engine — a hold placed after capture (exactly the
  case fraud review exists to catch) would be invisible under the
  frozen fact, and a hold since lifted would keep flagging a resolved
  invoice. The live join reads today's actual state.
- **Gated on `AP.FraudReview`, scoped by the invoice's own org unit** —
  the same gate and column decision 0420's `fraud-duplicates-route.ts`
  already established for this tab, and the only one available here:
  an unmatched invoice has no `supplier_id`, so Supplier Performance's
  own supplier-org scoping rule (decision 0416) cannot cover every row
  this route returns.
- **Fraud Prevention now shows two real cards, not one** —
  `ap-analytics.js`'s `tabContent()` "fraud" branch extends the same
  array-of-cards, each-fails-independently shape the `financial` and
  `supplier` branches already established.
- The proxy allow-list checked directly again, the same discipline
  every decision in this arc keeps: `/fraud/unapproved-suppliers`
  matched no existing wildcard — its own new entry added, a sibling of
  `/fraud/duplicates`, not a suffix of it.

### Supplier Performance, the remaining six metrics (0421)
- **The design document, read fresh, lists eight key metrics for this
  screen, not the seven decision 0416 recorded.** The extra one,
  "Active supplier count, by status," turned out to already exist
  elsewhere in this product — `/api/suppliers/status-counts` (decision
  0378), already gated on `AP.Supplier` and already rendered as a ring
  on the standalone Suppliers screen. A new thin wrapper module,
  `workers/vf-ui/public/supplier-status.js`, reuses that route and
  `charts.js`'s existing `donutChart()` for this tab rather than
  building a second backend metric.
- **Four genuinely new routes**, each gated on `AP.Supplier` and scoped
  on the supplier's own org unit like the rest of this screen: average
  cycle time (receipt to payment-eligible, reusing decision 0418's own
  final-stage definition), exception rate and type mix (reusing
  `stage_visits.validation_passed`/`validation_failures`, decision
  0021's own persisted verdict — the same definition
  `dashboard-route.ts`'s own `exceptionsBySupplier` card already
  uses), invoice variance to order value (recomputed directly from
  `invoice_headers` joined to `purchase_orders`, the same "never trust
  the ephemeral `po.variance_pct` fact" reasoning decision 0419 already
  established for spend under management), and payment terms held vs.
  negotiated with an on-time rate (negotiated days parsed narrowly from
  `suppliers.payment_terms`'s free text — only the `"Net N"` pattern
  this project's own data actually uses, excluding what doesn't parse
  rather than guessing; "on time" reuses decision 0418's own
  "payment-eligible = readiness to pay" definition rather than
  claiming knowledge of actual ERP payment execution this system does
  not have).
- **Six cards, not one, failing independently** — `ap-analytics.js`'s
  `tabContent()` "supplier" branch extends the same array-of-cards
  shape the `financial` branch established at two cards (decision
  0419) to six.
- **Hold history is newly found blocked, for a different reason than
  early-payment/discount.** No audit or history table exists anywhere
  in this codebase for any field on the supplier record, not only
  `on_hold` — only current state is stored, overwritten in place. See
  "Not built."
- The proxy allow-list checked directly again, the same discipline
  every decision in this arc keeps: all four new paths already matched
  the existing `/^\/suppliers\/[^/]+$/` wildcard, confirmed with a real
  fetch rather than assumed.

### Exceptions by type, by user, by supplier, trended — Fraud Prevention's third real metric (0423)
- **A genuinely new metric, not a re-listing of decision 0421's own
  supplier-exceptions card.** That one lives on Supplier Performance
  (`AP.Supplier`, scoped by the supplier's own org unit) and reports
  one aggregate rate per supplier over 90 days. This one lives on
  Fraud Prevention (`AP.FraudReview`, scoped by the invoice's own org
  unit, the same rule decision 0420 already established — the only
  one available here, since an unmatched invoice has no
  `supplier_id`), and adds a breakdown 0421 never attempted (by user),
  trended weekly rather than reported as one static number.
- **Trended as weekly counts, not weekly rates**, over eight
  Monday-anchored calendar weeks — a rate on a single week's small
  denominator would be noisy enough to mislead, and the design's own
  words ask only that a rise be *visible*, which a rising sparkline
  already shows without this route deciding for the viewer what counts
  as "rising."
- **`charts.js`'s own `sparkline()`, its first real caller.** Built by
  decisions 0242/0265 and left deliberately unused since — this is the
  card that comment was waiting for.
- **By supplier and by type count the exception itself, once per
  visit; by user counts completed review tasks, not exceptions.** A
  failing visit can spawn more than one task, one per matching line
  (`workflow-engine.ts`'s own documented behaviour), and each completed
  task credits whoever finished it — the identical unit
  `workload-route.ts`'s own throughput already counts by. A visit with
  three line-level tasks finished by three different people credits
  each of them once, so `byUser`'s own totals can legitimately exceed
  the exception count a supplier or type breakdown shows for the same
  window — a real, documented difference in what each breakdown
  measures, not a double-count bug. An exception whose task nobody has
  completed yet carries no user credit at all.
- **The unmatched-supplier bucket stays one shared entry**, never one
  per printed name — the same reasoning decision 0420 already gives for
  treating a printed name as a raw fallback, not a stable identity to
  group or trend by.
- The proxy allow-list checked directly again: `/fraud/exception-trends`
  matched no existing wildcard either, its own new entry added.

### Statistical outliers and segregation-of-duties flags — Fraud Prevention's fourth and fifth real metrics, built together (0424)
- **Both built in one request, at the operator's own direction.** Asked
  "what would be next" after decision 0423 shipped, offered four
  ranked candidates; the operator's own answer, "Can you tackle 1 and
  2," chose both statistical outliers and segregation-of-duties flags
  rather than one at a time — the same bundling precedent decision
  0421 already set for Supplier Performance's own remaining six
  metrics.
- **Statistical outliers — a z-score against a supplier's own history,
  self-excluded.** `workers/vf-app/src/fraud-statistical-outliers-
  route.ts` (`GET /fraud/statistical-outliers`) groups each supplier's
  own priced invoices by `(supplier, currency)` — never mixing
  currencies or suppliers into one baseline — and computes a candidate
  invoice's mean and standard deviation from every *other* invoice in
  its own group, so the candidate can never pull its own baseline
  toward itself. A named, arguable threshold (`Z_SCORE_THRESHOLD =
  2.5`) and a named minimum sample size (`MIN_HISTORY = 5`) are stated
  directly in the route's own doc comment rather than left implicit —
  fewer than five other same-currency invoices for a supplier means no
  baseline is trusted, and that invoice is excluded entirely rather
  than measured against a mean of one or two points, the same
  "exclude rather than fabricate" discipline decision 0421's own
  payment-terms route already applied. **A zero-variance history gets
  an honest `null`, never a fabricated number** — when every historical
  invoice for a supplier carries the identical amount, a z-score is
  mathematically undefined; a candidate that still differs from that
  identical amount is flagged with `zScore: null` (an "undefined
  magnitude") and sorts first, ahead of any numeric score.
- **Segregation-of-duties flags — anchored on `AP.Approve`, the
  design's own named action, paired generically with any other
  distinct permission.** `workers/vf-app/src/fraud-segregation-of-
  duties-route.ts` (`GET /fraud/segregation-of-duties`) flags a person
  whose own `completed_by` covers both a task whose stage declared
  `required_permission = 'AP.Approve'` and at least one other task on
  the same invoice whose stage declared a different, non-null
  permission — reading `process_stages.required_permission` (decision
  0048's own "a stage declares its own permission"), not a hardcoded
  stage id, so the rule stays correct for any customer's own process
  shape. The other side of the pair is deliberately generic rather
  than naming a second specific permission, so it does not silently
  stop working the day a process is reshaped; a stage with no declared
  permission at all (a pass-through stage, decision 0080's own
  automatic stages) never contributes either half. One flag per
  invoice, not per pair of tasks — the flagged invoice lists every
  stage that person completed on it, in the order they completed them,
  so a reviewer can judge whether it's a real control gap or an
  explainable one-off.
- **Both gated `AP.FraudReview`, scoped `h.org_unit_id`** — the same
  gate and scoping column every other Fraud Prevention route already
  uses. Both are worklists, not top-N rankings, the same shape
  `/fraud/duplicates` and `/fraud/unapproved-suppliers` already use.
- **Fraud Prevention now shows five real cards, not three** —
  `ap-analytics.js`'s `tabContent()` "fraud" branch extends the same
  array-of-cards, each-fails-independently shape decisions 0422 and
  0423 already established, from three cards to five.
- The proxy allow-list checked directly again, the same discipline
  every decision in this arc keeps: neither `/fraud/statistical-
  outliers` nor `/fraud/segregation-of-duties` matched any existing
  wildcard — both got their own new entry.

### Consolidated spend across org units / legal entities — the Multi-Enterprise CFO View's first real metric (0425)
- **Executive IQ gains real content — the last of AP Analytics' five
  tabs to do so.** Asked "what would be next" after decision 0424
  shipped, offered four ranked candidates; the operator chose
  Executive IQ / Multi-Enterprise CFO View. The design's own Screen 5
  section flags two real decisions before this screen could be built at
  all, both put to the operator directly rather than assumed: the
  scoping approach (reuse `holdsEverywhere` with `GROUP BY
  org_unit_id`, the design's own recommended "Option 1," over a
  genuinely new multi-select org-comparison scope its own "Option 2"
  explicitly defers) and which of the screen's six key metrics to build
  first (consolidated spend, the design's own first-listed bullet,
  reusing data no new capture is needed for).
- **No new access-control concept.** The design's own Role-Based Access
  Model table for this screen already matches the pre-existing
  client-side tab gate exactly — `AP.Analysis` and `holdsEverywhere =
  true`, checked independently. `workers/vf-app/src/executive-
  consolidated-spend-route.ts` (`GET /executive/consolidated-spend`)
  checks both again server-side, the same "a hidden tab is not a closed
  route" discipline decision 0417 established for every other tab.
- **Enterprise-wide by definition — no `?org=` narrowing, on either the
  route or the card.** Every other analysis route in this codebase
  narrows to a chosen org; this one deliberately does not, since the
  entire point of this screen is comparing every entity a CFO is
  responsible for in one place — narrowing to one chosen org would
  collapse the comparison back into the same one-org-at-a-time view the
  design's own "real gap" section names as the problem.
- **Grouped by the invoice's own recorded `org_unit_id`, exactly as the
  design's own "Option 1" says — no invented rollup from an operating
  unit up to its own parent legal entity.** An invoice's `org_unit_id`
  may name either kind (decision 0226); this route reports each
  recorded unit exactly as named, carrying its own `kind` so a reader
  can tell a legal entity from an operating unit rather than the two
  being silently blended. Never summed across currencies — the same
  discipline decisions 0416, 0418, 0419 and 0421 already follow — and
  an invoice with no recorded org unit is excluded, not guessed into a
  bucket.
- **`workers/vf-ui/public/executive-consolidated-spend.js`, new** —
  reuses `charts.js`'s own `barList()`, first built for and proven by
  decision 0416's "Spend by supplier" card. `ap-analytics.js`'s
  `tabContent()` gains a real `executiveiq` branch — one card, not the
  whole six-metric screen, the same "one real vertical slice first"
  discipline every other tab on this screen started with.
- The proxy allow-list checked directly again, the same discipline this
  whole arc keeps: `/executive/consolidated-spend` matched no existing
  wildcard either, its own new entry added.

### Early-payment discount eligibility and hold history — Supplier Performance's last two metrics, the screen's own full parity with the design (0427)
- **"Lets finish off Supplier Performance."** Both of this screen's own
  remaining metrics had been genuinely parked, not merely deferred (see
  their own now-resolved entries under "Not built" above) — so before
  building either, three real design decisions were investigated and
  put to the operator directly rather than assumed.
- **How discount terms are captured**: structured `discount_pct`/
  `discount_days` fields added to `suppliers` (migration 0072,
  CSV-loadable like `payment_terms` already is), over parsing a
  discount schedule out of existing free-text fields — the operator's
  own choice, matching their own prior instinct that terms belong on
  the supplier record.
- **What "capture rate" could honestly become with only structured
  fields, no payment-execution data**: the design's own literal metric
  needs to know whether a discount was actually *taken*, which nothing
  in this codebase records for any invoice. Surfaced directly, the
  operator chose to build eligibility instead of capture rate — which
  currently-open invoices sit inside their supplier's own discount
  window today — an honestly narrower, differently-named metric, not
  that one finished.
- **How hold history is captured**: a general field-change audit trail
  (`supplier_field_changes`, migration 0072) over a hold-specific
  history table — the operator's own choice, and the broader of the
  two options offered. Justified by investigating all three real write
  paths into `suppliers` first: CSV mirror-load (`load-suppliers.ts`,
  "replace rather than merge," 0208 — can silently flip `on_hold` on
  every reload), the hand-edit route, and the hold/release route
  (0230's "four acts, one route"). All three are now wired to
  `diffSupplierFields()`/`recordSupplierFieldChanges()`
  (`workers/vf-app/src/supplier-audit.ts`), diffing 23 auditable
  fields and writing one row per real change, insert-only.
- **Deliberately separate from decision 0350's own
  `detectSupplierChanges`/`spawnSupplierMaintenanceInstance`
  mechanism**, left completely untouched — that one watches a narrower
  `WATCHED_FIELDS` set to spawn a Supplier Maintenance review task, a
  different purpose from this general audit trail, and repurposing it
  would have risked its own tested, narrow behavior.
- **`GET /suppliers/discount-eligibility`**
  (`supplier-discount-eligibility-route.ts`) — open invoices whose
  supplier carries discount terms and are still inside the discount
  window, grouped by currency (never summed across them, the same
  discipline every money-reporting route on this screen already
  follows), then by supplier within each currency
  (`supplier-discount-eligibility.js`, reusing `charts.js`'s own
  `barList()`). A supplier with no discount terms is excluded, not
  guessed into a zero.
- **`GET /suppliers/hold-history`** (`supplier-hold-history-route.ts`)
  — pairs each `on_hold` 0→1/1→0 transition recorded in
  `supplier_field_changes` into a discrete period, carrying whatever
  `hold_reason` was recorded alongside it; an unresolved hold is
  reported as ongoing (`endedAt: null`), not dropped; a supplier held
  since its very first-ever load has no prior row to diff against, so
  it is honestly reported as having no recorded period, not backfilled.
  Rendered as a plain table (`supplier-hold-history.js`), matching
  `fraud-duplicates.js`/`supplier-payment-terms.js`'s own precedent for
  a metric the design gives no visualization suggestion for and which
  carries more than one fact per row.
- **Both routes scoped the same way this screen's own other routes
  already are** — `unitClause`/`unitsWherePermitted` on
  `sup.org_unit_id`, matching `supplier-payment-terms-route.ts`'s own
  pattern — a deliberate contrast with Executive IQ's own enterprise-wide,
  unscoped design (0425).
- `ap-analytics.js`'s `tabContent()` now loads all eight of Supplier
  Performance's own cards in one `Promise.all`, each failing
  independently — the same discipline `financial` and `supplier`
  already established, extended from six cards to eight.
- **A note left for whoever picks up Liabilities & Accruals next**: its
  own "invoices eligible for early payment / dynamic discount, by
  volume and by amount" is close kin to what this decision just built,
  aggregated differently — see that screen's own "Not built" entry.

### User & Team Workload's remaining seven metrics — the screen's own full parity with the design, six of seven metrics built whole (0428)
- **"shall we tackle - User & Team Workload 1/8. - 7 metrics, none
  previously tracked"** — the operator's own explicit instruction.
  Workload's own design-list count had never actually been checked
  against the codebase before this decision; only "Throughput by user,
  stacked by stage" (0415) existed of its own eight key metrics.
- **"All seven together"** — the operator's own choice, over building
  one metric at a time, once asked how much of the remaining seven
  should be tackled in one decision.
- **The one genuine structural gap, surfaced before building**: "tasks
  pending action and approaching/past due" needs a per-task due date,
  and none exists anywhere in this schema. `hold_until` is the only
  date-like concept anywhere near a task, and it is a fired rule
  *action* recorded in the activity log against an *invoice*
  (`activity-route.ts`'s own `describeAction`), never a queryable
  column on a *task* — confirmed by grepping the whole codebase for
  every use of `hold_until`. Put to the operator directly: build
  "pending over a period" only, honestly leaving "approaching/past
  due" unbuilt, or hold the whole metric back until a due-date column
  exists. The operator chose **"pending over a period" only**
  (recommended).
- **Seven new routes**, all gated `AP.Analysis` like the rest of this
  screen, all reusing existing tables — no new `vf-app` migration:
  - **`GET /workload/open-tasks`** — per-user open-task counts plus one
    shared "available" (unclaimed) total. Deliberately drops the
    per-viewer "locked" ownership concept `task-list-route.ts`'s own
    `ownershipOf` computes — it is inherently relative to one viewer,
    and meaningless as an absolute column in an aggregate manager view.
  - **`GET /workload/handling-time`** — average claim-to-complete hours
    by *(stage, user)*, a matrix, rendered as a plain table matching
    decision 0427's own hold-history precedent for a metric that is not
    a single ranked dimension.
  - **`GET /workload/cycle-time`** — the same claim-to-complete
    measurement, aggregated per user only — the design's own adjacent
    bullet to handling time, kept as its own separate metric rather
    than folded in.
  - **`GET /workload/pending`** — open tasks past 3/7/14-day age
    thresholds (`created_at`, not `claimed_at`), split by user plus one
    shared "unclaimed" row. A user with nothing past even the shortest
    threshold is omitted from the response entirely, not shown as a row
    of zeros — a bug caught by its own test and fixed before this
    shipped.
  - **`GET /workload/queue-depth`** — available vs. locked task counts
    per team, scoped by the team's own org unit (`org_teams.unit_id`,
    0064) rather than reaching through a task's own invoice — more
    direct for a team-level metric. Rendered with `stackedBarChart`,
    the same shape `workload.js`'s own throughput card already
    established, two fixed segments instead of a stage's own
    colour-coded buckets.
  - **`GET /workload/balance`** — per-team variance in open-task count
    across that team's own members (population mean, variance,
    `stdDev`), teams sorted most-imbalanced first. Rendered as one
    labelled group per team (`.teamgroup`/`.teamgrouphead`, a new CSS
    class pair — not `.spendcurrency` reused, matching decision 0417's
    own naming discipline), each wrapping a `barList` of that team's own
    members.
  - **`GET /workload/exceptions`** — reuses decision 0423's own
    exception definition (`stage_visits.validation_passed = 0`) under
    `AP.Analysis` rather than `AP.FraudReview`, framed as coaching
    ("not to assign blame... to see where extra support or training
    would help") rather than fraud review — a flat count, not trended.
- **`vf-ui`'s `PROXIED_TO_INSTANCE` regex widened**, not extended with
  seven new exact-match entries — the pre-existing exact
  `/^\/workload\/throughput$/` becomes `/^\/workload\/[^/]+$/`,
  matching the `/suppliers/[^/]+$/` precedent already used for this
  screen's own sibling family.
- `ap-analytics.js`'s `tabContent()` now loads all eight of Operational
  Performance's own cards in one `Promise.all`, each failing
  independently — the same discipline every other multi-card tab on
  this screen already established.
- **Strings**: `workers/vf-licence/migrations/0139_workload_remaining_
  seven_metrics_strings.sql` — 34 keys, English and German (68 rows).

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
- **The rendering guard now refuses a declared foreign profile, not an
  undeclared one** (0405). It had required a `CustomizationID` naming
  Peppol BIS Billing 3.0 since it was built (0205) — which every
  invoice this system has ever actually captured, in production and in
  every test fixture, has lacked; rendering had never once succeeded
  for a real document. The traversal itself reads plain UBL structure
  regardless of any formal declaration, so an invoice that names no
  profile at all now renders too; one that names a genuinely different
  profile still does not
- **A generated rendering (HTML) shows in the viewer's Document tab
  now, not just in R2** (0406). `pageViewer()` (0382) only knows PDF
  and "everything else is an image" — an HTML rendering fell into the
  image branch and failed to decode silently. The very first invoice
  0405 ever actually rendered surfaced this immediately; routed to the
  same signed-URL iframe the XML tab already uses instead
- **The original plan (0013, 0035) was always a PDF, not HTML — found
  written down, investigated, deliberately not built yet** (0407). Two
  real paths exist (Cloudflare Browser Rendering printing the existing
  HTML, which would inherit 0206's already-built pagination CSS for
  free; or a pure-JS layout library, fully local-testable but a second,
  separately-maintained rendering); operator's call is to stop here for
  now and keep 0406's iframe fix as the working answer

### The control plane
- Signed ECDSA licence tokens, fail-open cache, bootstrap exception
- One customer, many environments — sandbox and production (0036)
- Self-serve trial signup with a human approval checkpoint (0038)
- Control-plane provisioning: customer, environment, trial licence (0039)
- Staged expiry warnings at 14/7/1 days, then blocking (0040)
- Usage telemetry, per environment, aggregate-only

### The interface
- **Claiming a task inside the document viewer keeps the viewer open,
  now unlocked, instead of closing back to the task list** (0414).
  Reported live: *"Upon selecting Claim, I am redirected to the task
  list. However it would be preferable to open the same viewer in edit
  mode, now that I have claimed the document."* `runAction()` closed
  the viewer unconditionally after any action the server accepted, on
  reasoning that held for Complete, Return, Discard and Return to
  supplier (each finishes or moves the task away) but not for Claim,
  which only changes who holds the lock. Reopening on the same stale
  `task` object would not have unlocked anything either —
  `canEditAnything` reads `task.ownership` at open time, and the
  claim response itself carries no such field — so `tasks.js` gains
  `refreshTask(taskId)`, re-fetching the list and handing back the one
  row now claimed, for `runAction()` to reopen the viewer on. Release
  and every other action keep their existing close.
- **Changing language no longer bounces the main window to the default
  screen** (0413). `languagePicker()` had reloaded the whole page since
  0302, which always lands on the default screen regardless of what
  was open — the same reload-loses-focus gap 0362 already fixed for
  the org switcher, by relaunching via `go()` instead of reloading.
  `languagePicker()` now takes an `onChosen` callback the same shape
  `orgPicker` already has; `relaunchAfterLanguageChange()` refreshes
  strings, then relaunches the current screen or reopens the exact
  task that was open. The one real difference from
  `relaunchAfterOrgChange()`, which falls back to the default screen
  instead: an org-scoped invoice does not survive an org switch, but a
  language change has no such relationship to the document on screen,
  so this keeps it in view rather than dropping it.
- **A skin or language change in the main window now reaches the
  document pop-out too, while it is already open** (0412). The pop-out
  (0384) carries no mood or language button of its own and only ever
  read either setting once, at its own boot, so a choice made in the
  main window behind it never arrived. Fixed with `storage`, the one
  event a same-origin window gets for free when a *different* window
  writes to `localStorage` — no message channel built, the same
  platform-primitive choice 0384 already made for retargeting the
  pop-out to a different task. A mood change re-applies the attribute
  live (pure CSS from there); a language change reloads, matching what
  the language button's own click already does on the window where
  somebody clicked it.
- **A line-scoped rule's own firings collapse into one Timeline/Chat
  entry, not one per line it matched** (0409). A rule set scoped to
  evaluate per line (0027) runs once per invoice line, and the
  activity feed (0267) used to turn a rule matching on eight of twelve
  lines into eight identical, same-timestamp entries. Grouped
  server-side by the visit and rule that fired, carrying which lines
  matched rather than discarding that — *"...fired: flagged it (lines
  2, 5, 7)"*, not the same line three times over
- **The nav works from inside an open task, not only from the task
  list** (0408). `openViewer()` renders its own copy of the nav into
  `#viewer`, a sibling `#shell` hides/shows on the way in and out — but
  `go()`, the one function behind every nav link, wrote into `#shell`
  unconditionally with no check for which of the two was on screen. A
  nav click from inside an open task silently rebuilt the hidden
  `#shell`; nothing visibly changed. Decision 0362 had already solved
  this once for the org switcher's own relaunch; the same check now
  lives in `go()` itself
- `vf-ui`, one shared deployment for every customer (0099)
- Sign-in, with the session in an `HttpOnly` cookie the JavaScript
  never sees (0102)
- Task Manager: one list across every stage, ownership as a column,
  actions the server decides (0103, 0104, 0105)
- Validation viewer: the retained original beside the fields it should
  have yielded, with an editable line table (0106, 0109)
- **The claim gate (0288: a document must be claimed to be edited, not
  just opened) now actually covers the line table too** (0403). It was
  only ever checked for header fields; an unclaimed or someone-else's
  document rendered its header correctly as read-only text and its line
  items as real, editable inputs regardless — traced from what first
  looked like a purely visual report ("Header fields look square, Lines
  look rounder"), which turned out to be locked fields rendering as
  plain text with no box at all (0114) beside editable fields' real,
  rounded input boxes — not a radius mismatch. `.readonly` now shares
  the app's rounded-corner shape (a subtle fill, no border, so it still
  does not read as clickable)
- **The Invoice Lines table's column headers match the Tasks/Documents
  header style** (0404). `.linetable th` had never set its own font
  weight or colour, so it fell back to a `<th>`'s browser-default bold
  plus whatever text colour was around it — `--text-primary`, which
  reads as near-white at Night. Copied `#shell th`'s actual values
  (weight 500, `--text-secondary`, `--text-sm`) — the rule that
  genuinely governs both those screens' headers today, not
  `.tablewrap th`'s own declaration, which a same-page id selector has
  always outranked
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
- **The country stays a code** (0389, superseding 0221 in part). 0221
  chose the Peppol long name on purpose — "say what the image says" —
  and `GB` expanding to "United Kingdom of Great Britain and Northern
  Ireland" is not what an invoice actually says either, which the
  operator caught directly and asked to revert. `addressBlock()`, the
  one function both the Seller and Buyer cards call, now reads
  `party.country` alone rather than `party.countryName ?? party.country`
  — one fix reaches both cards. `countryName` is still computed and
  sent by `invoice-facts-route.ts`, checked as read nowhere else, and
  left in place as unused rather than removed, the same call decision
  0387 made for the fields it dropped.
- **Three fifths, two fifths, and a freed rail** (0390). Asked
  directly against two mocked-up, measured options: `#viewer .columns`
  moved from `2fr 1fr` (each of Seller, Buyer, Document roughly a
  third) to `3fr 2fr` (Seller/Buyer share three fifths, Document two
  fifths) — 660px/440px on the render measured, not approximated.
  Measuring the *current* Document card before touching anything found
  `.vpreview` sitting at exactly its own `min-height: 320px` floor — a
  rule written for the pre-0388 layout (decision 0271) — because
  `height: auto` (0388's own override) sizes to content on a plain
  block element, and an empty preview has none; changed to `height:
  100%`, which now fills whatever the card is actually given. The
  thumbnail rail is hidden while docked regardless of page count —
  `#viewer .vrail { display: none; }`, a second, independent reason
  alongside `page-renderer.js`'s own single-page `.hidden` logic, which
  stays untouched and still governs the pop-out window — freeing the
  rail's 92px for the canvas automatically, via `.vmain`'s existing
  `flex: 1`. No test needed changing; the fragile decision-0281 nav
  test and the full suite were both rerun to confirm, not assumed.
- **The Document card stops borrowing space** (0391, superseding part
  of 0390's own reasoning). Zooming an invoice image grew the Document
  card itself, pushing large blank gaps into the process/parties/
  header column beside it — reproduced first with a genuinely tall
  test image, which measured `.c-process`, `.c-parties` and
  `.c-header` all inflating, not just the Document card. The cause:
  CSS Grid's own "increase sizes to accommodate spanning items" step,
  which runs for `auto`, `min-content` *and* `max-content` tracks
  alike (checked by trying `min-content` explicitly and watching the
  same inflation happen) — there is no track-sizing keyword that lets
  a spanning item's content need more room without its spanned tracks
  growing to give it that room. `position: absolute` on `.c-document`
  is the one technique that actually works: it removes the item from
  the sizing algorithm entirely while its resolved `grid-area` still
  becomes its containing block (`#viewer .columns` gained `position:
  relative` for this to anchor to), so the card is now capped to
  exactly what process+parties+header naturally add up to, every
  time, not just when nothing large enough was drawn to notice. Doing
  that surfaced a second, real regression, found by re-measuring
  rather than assumed clean: decision 0390's own `.vpreview { height:
  100%; }` now resolves against a genuinely shorter parent on some
  invoices, and the base rule's leftover `min-height: 320px` (decision
  0271) then won, growing the preview past its own card's bottom —
  fixed with `min-height: 0` for the docked case specifically. The
  scrolling this implied — `.vcanvasholder { overflow: auto; }`,
  already there since decision 0382 — turned out to need no new code
  at all once the box itself stopped growing to swallow the overflow;
  measured directly (`scrollHeight` exceeds `clientHeight`, `scrollTop`
  actually moves). The narrow, single-column screen broke the same way
  the wide fix was built — `document` has nothing else in its own row
  there to size itself by once taken out of the algorithm, measured
  collapsing to `0` — reset with `.c-document { position: static; }`
  inside that width's own, pre-existing media query.
- **More room in every direction** (0392). Asked directly: whether
  zoom can go past its own frame, whether the Document card's row can
  be reclaimed once popped out (Seller/Buyer/Header sharing one row),
  and whether the pop-out placeholder can shrink to free that space.
  The zoom control was never actually stuck — the canvas genuinely
  redraws at higher resolution each click (measured 1000→3000px across
  five clicks) — only `.vcanvas { max-width: 100% }` clamping the
  *display* width regardless; fixed by lifting the clamp only once
  zoomed in past the default step (`.zoomedin`), with drag-to-pan
  added via pointer capture rather than `window`-level listeners (no
  teardown hook exists to remove those, per decision 0382's design).
  For the reclaimed row: two more complex approaches — an equal-thirds
  split with a dedicated placeholder row, and moving Header's DOM node
  into Parties via JavaScript — were mocked up, measured, and rejected
  in favour of a zero-DOM-move version: `.c-header` stays exactly
  where it's always been, and a `docpoppedout` class on `.columns`
  changes only `grid-template-areas`, letting `.parties`'s own
  pre-existing internal grid split Seller from Buyer automatically.
  25%/25%/50% was chosen over 30%/30%/40% after both were measured —
  30/30/40 leaves Header too narrow for its own natural layout, so it
  grows *taller* instead (350px vs 258px), landing Lines at 613px
  against 25/25/50's 520px. A CSS specificity bug — the extra class on
  `.docpoppedout` outranking the plain narrow-screen `.columns` rule
  regardless of media query — was reproduced deliberately and fixed
  before shipping, not after. Verified against the real production
  code, not mockups alone, through a full open→reflow→close cycle at
  both wide and narrow viewports, restoring the exact pre-Expand
  layout on close. Three new tests, each watched to fail against the
  pre-fix code first. Full suites: vf-ui 74 Worker + 669 browser
  (666 pre-existing + 3 new), both passing.
- **Filling the row, and a number to ring** (0393, correcting two real
  bugs in 0392's own work and reversing part of 0387). Asked against a
  screenshot of the deployed 0392 layout: the popped-out placeholder
  sat visibly shorter than Process beside it, and Seller/Buyer ended
  well above Header's own bottom. Measured, both were real — 44px vs
  Process's 90px; 244px vs Header's 421px — and traced to the same
  shape twice: `align-items: stretch` was already stretching the
  *outer* grid item to match its row, but nothing told the *visible
  panel inside it* to fill that box. Fixing Document's own side
  surfaced a third instance of the identical bug on Process's side,
  found only by re-measuring after the first fix: once Document's
  badge could be taller than Process's own content, Process needed
  the identical `height: 100%` treatment too, or the gap just moved to
  the other card. The placeholder's actions changed from a row-format
  override back to the plain, unmodified `.actionlink` square —
  deleted outright rather than replaced, so "Bring to front" and "Show
  here instead" now look like "Header Fields" the same way every other
  cardhead action already does — and its text moved left and reads
  "Document open in a separate window" (`ui_strings`, migration 0122).
  Separately: `addressBlock()` now joins city and country onto one
  line ("Felixstowe, GB"), and Phone — dropped by decision 0387 along
  with E-address and E-mail to give the card back a column — is back
  beneath the address alone, since `s.phone`/`b.phone` never stopped
  being fetched, only read. Five new tests, all watched to fail
  against the pre-fix code first, plus one existing test corrected for
  a wording change (widened from an exact string to the substring both
  wordings share, since asserting the exact new text is the newer
  test's job). Full suites: vf-ui 74 Worker + 674 browser (669
  pre-existing + 5 new); vf-licence 320/320, both passing.
- **A column, two arrows, and a marker** (0394). An evaluation request
  — Timeline / Chat as a right-hand column, next/previous page
  cycling, and highlight annotations — mocked up before anything was
  built, then scoped by the operator's own choices against the
  mockups. Timeline / Chat moves to a standing `.docwindowsplitright`
  column at 25% width, pop-out only, built entirely in
  `initDocumentWindow()`'s own layout code so the embedded card (which
  shares `buildDocTabs()`, decision 0384) is untouched; the one real
  trap was `buildDocTabs()`'s shared `select()` closure re-hiding the
  timeline pane as a side effect of switching to Document or XML,
  caught and worked around by re-showing it after each remaining
  button's own handler runs. Previous/next page buttons reuse the
  thumbnail rail's existing `selectPage()` — nothing new tracks
  "which page" — and land in the shared control row, so they appear
  in both the pop-out and, by the operator's own choice, the embedded
  card too. The highlight tool is a deliberate "small first cut" of
  annotations rather than the full feature: session-only rectangle
  highlights, recorded as a fraction of the canvas's own rendered box
  (valid across zoom, since `drawRotated()` never letterboxes), and
  cleared on rotation or page change rather than mis-projected. Ten
  new tests, all watched to fail against the pre-fix code first;
  `canvas.getBoundingClientRect()` stubbed directly in the highlight
  tests since jsdom always reports a zero-size box for it. Full
  suites: vf-ui 74 Worker + 684 browser (674 pre-existing + 10 new);
  vf-licence 320/320, both passing.
- **A fourth state, and a borrowed accent** (0395, tokens only — first
  of four decisions building out a look borrowed, piece by piece, from
  another product this team built). Four new `tokens.css` tokens, Day
  and Night both: `--heading-accent` (reusing `--text-warning`'s own
  proven pair rather than the reference site's raw orange, which read
  under 3:1 on `--surface-2`); `--bg-danger`/`--text-danger`, a fourth
  semantic state splitting "this is wrong" off from `--bg-warning`'s
  "look at this," which had been carrying both; `--border-danger`,
  Day-only like `--border-warning`/`--border-success` already are.
  Nothing consumes any of them yet — no visual change. Two new tests
  in `mood.test.ts`, watched to fail against the pre-change file first
  (2 of 14 failed, exactly the new assertions). Full suites: vf-ui 74
  Worker + 686 browser (684 pre-existing + 2 new), both passing.
- **A title in its own face, and a line beneath it** (0396, second of
  the four — the two global pieces, together). Every panel title now
  sets a self-hosted Big Shoulders Display (one weight, 800, shipped
  the way Carlito was, 0124), uppercase, in `--heading-accent`, at
  `--text-lg`; a `border-bottom` in `--border-strong` runs beneath
  every card title's own row. CSS-only, no JS touched — every card
  already had one heading element to extend. Scoped to `.panel > h3`/
  `.panel > .cardhead > h3`, deliberately not bare `.cardhead`, which
  keeps it off every modal dialog's title and off the dashboard's KPI
  tiles (nested inside `.tilefg`, never a direct child of `.panel`)
  without either exclusion needing to be written by name. Five new
  tests in `typography.test.ts`, watched to fail first (4 of 30
  failed, exactly the new assertions). Full suites: vf-ui 74 Worker +
  691 browser (686 pre-existing + 5 new), both passing. Not yet
  reviewed screen by screen — the widest-blast-radius piece of the
  four by design.
- **The first live look back at 0396** (0397, two corrections from
  the operator's own first look at the deployed app rather than the
  mock-up). A card whose action is taller than its title (Purchase
  Orders' CSV Template/Load CSV, wrapped in `.statebuttons` and so
  outside `.cardhead > .actionlink`'s existing `-6px` pull) left the
  title pinned to the top of the row with a gap above the new rule;
  `.panel > .cardhead { align-items: flex-end; }` plus a compacted,
  card-scoped `.actionlink` fixes it, checked with Playwright against
  the real stylesheet before and after. The Dashboard's own KPI tiles,
  deliberately left quiet by 0396's own scoping, read as unfinished
  once "On my clock" picked up the new heading on its own — three ways
  to resolve it rendered and shown side by side, the operator chose
  directly to extend the heading and the rule to every tile via
  `.panel > .tilefg > .cardhead`, removing a `.card-narrow` override
  that had never actually matched anything. Nine new tests, watched to
  fail first (7 of 35 failed). Full suites: vf-ui 74 Worker + 696
  browser (691 pre-existing + 5 new), both passing.
- **A toggle for the document tabs** (0398, third of the four —
  narrow and independent). Styling only, no JS touched — the same
  four class names `buildDocTabs()` already built, before and after.
  `.doctabs` becomes a filled, fully rounded pill; `.doctab` drops its
  underline for a transparent border; `.doctab.on` fills that border
  and picks up a new `--tab-active-shadow` token, a real shadow by Day
  and `none` at Night; `.activitycount` moves to the accent colour.
  Deliberately kept separate from `.tabbar` (0333's own Access-screen
  switcher, underline-only for a row of sections rather than views of
  one thing), with a test guarding that distinction going forward.
  Checked with Playwright against the real, unmodified stylesheet
  before being called done, Day and Night both. Five new tests in
  `typography.test.ts`, one plus a list entry in `mood.test.ts`,
  watched to fail first (5 of 55 combined failed). Full suites: vf-ui
  74 Worker + 702 browser (696 pre-existing + 6 new), both passing.
  Not yet reviewed live — the narrowest of the four by design.
- **One pill for every tab** (0399, a direct follow-on to 0398, asked
  the same day: apply the same pill treatment to the Access screen's
  own Org Units/Roles/People/Teams switcher). Reverses part of 0333's
  and 0398's own stated reasoning for keeping `.tabbar` underline-only
  and separate — on purpose, per the operator's own request, recorded
  in `SUPERSEDED.md`. Styling only, no JS touched — `.tabbar`/`.tab`/
  `.tab.active`, the same three class names `tabBar()` already built.
  `.tabbar` takes `.doctabs`'s own exact shape and reuses its
  `--tab-active-shadow` token rather than a second one invented for
  the same job. Checked with Playwright against the real stylesheet,
  Day and Night both. Full suites: vf-ui 74 Worker (unchanged) + 704
  browser (702 pre-existing, net +2), both passing.
- **Three tiers for the fourth piece** (0400, closing the sequence
  0395 opened — red, amber, green on the validation screen's key
  fields and exceptions list). Investigated first: no upstream
  distinction between "mismatch" and "needs review" existed to
  repurpose, so three scope choices went to the operator directly —
  wire the existing PO three-way-match into the exceptions pipeline
  (yes), bring back the hidden exceptions panel (no, left hidden), and
  the green state's own definition (Claude's judgement). Backend: a
  new `po_mismatch` check (`validation.ts`), a required `severity`
  ("danger" for `po_mismatch`, checked against a linked purchase
  order; "warning" for the original six, the document's own numbers
  disagreeing with themselves) on every failure, and `confirms` —
  `ValidationFailure`'s own positive twin, deliberately not given to
  `total_missing` on a pass, since presence is not agreement. Frontend:
  four new mood-invariant severity tokens (pale in both Day and Night,
  per the operator's own correction to the first mock-up — *"can you
  use the paler 'day' colours for the night scheme also?"* — rather
  than redarkening the general warning/success tokens used in ~15
  other places), a three-pass deterministic paint order in
  `markFields()` (danger always wins a field over warning or ok, never
  dependent on array order), and a small dot beside a `.kf` field's
  label. Found and fixed, along the way, a genuine pre-existing
  off-by-one in the line-cell marking logic (`row.children[index + 1]`
  should have read `index`) — present since before this decision,
  caught only by screenshotting a real line cell for the first time.
  Visually verified against the real integrated markup with Playwright,
  Day and Night both, not just the standalone mock-up. 20 new tests
  across `vf-app` (15) and `vf-ui` (5), plus two existing `vf-ui`
  tests rewritten in place for the new tiers, all fail-first verified.
  Full suites: vf-app 1936/1936, vf-licence 320/320, vf-ui
  74 Worker + 709 browser (704 pre-existing, net +5 — two existing
  tests rewritten in place for the new tiers, five added). `key-fields-route.ts` wires
  header-level `po_mismatch` only — its line facts are a pre-existing,
  unparsed shape this decision does not reach into; documented at the
  call site rather than silently left or silently expanded in scope.
- **Six titles, and a subtitle gone** (0401, a direct wording request
  against six Dashboard card titles). "Waiting for me" → "My Tasks by
  Stage", "Where things are" → "All Open Tasks by Stage", "How long
  they have waited" → "Task Aging Report", "On my clock" → "My
  Priority Tasks", "Suppliers awaiting the ERP" → "Supplier Setup
  Required", "Done" → "Tasks Completed This Week" — all six are
  `ui_strings` values reworded in place (migration `0125`, English and
  German both), the keys themselves untouched. "On my clock"'s own
  subtitle ("Assigned to me or claimed by me — not a team queue") is
  removed outright rather than reworded — the `dashboard.js` line that
  rendered it is deleted; its `ui_strings` row stays seeded, migrations
  here never deleting a row, and comes out of
  `string-coverage.test.ts`'s used-keys list instead. Roughly twenty
  test call sites in `dashboard.test.ts` updated to the new wording,
  with two verbatim historical quotes ("the Waiting for me card...")
  deliberately left unchanged, and "Done" handled carefully rather than
  blind-replaced since it also appears inside the unrelated "Done
  arranging" string. Full suites: vf-licence 320/320, vf-ui 74 Worker +
  709 browser (same count — a rename, not an added or removed test).

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

**The design document names six new dashboard additions, not five —
`docs/PROGRESS.md` and every decision through 0425 had only ever
tracked five.** Re-reading the design directly (rather than this
file's own prior summary of it) surfaced a Screen 6, "Talk to an AP
Expert," that had never once been named here — see its own entry
below. Correcting the record: of the six screens with at least one
real metric behind them, four of Liabilities & Accruals' own six, one
of Fraud & Risk Detection's own six, and five of the Multi-Enterprise
CFO View's own six stay unbuilt — **Supplier Performance and User &
Team Workload are the first two of the six screens to reach full
parity with their own design lists** — Supplier Performance all eight
of its own key metrics (0421, 0427), Workload all eight of its own
(0415, 0428) — **though Workload's own "tasks pending action and
approaching/past due" is honestly only half of what its own design
bullet names**: 0428 built "pending over a period" (three fixed
thresholds — 3, 7, 14 days), by the operator's own explicit choice,
and did not build "approaching/past due," because no due-date column
exists anywhere on a task in this schema — `hold_until` is the only
date-like concept anywhere near a task, and it is a fired rule
*action* recorded in the activity log against an *invoice*
(`activity-route.ts`), never a queryable column on a *task*, confirmed
by grepping the whole codebase. Workload's own count had never
actually been checked against its own metrics list before 0428; only
"Throughput by user, stacked by stage" (0415) existed, and the other
seven — open task count by user split by ownership, average handling
time by stage and by user, claim-to-complete cycle time, tasks pending
action (and approaching/past due, not built), team queue depth
(available vs. locked), workload balance (variance in open-task count
across a team), and exceptions by user — had never been raised as a
decision before the operator's own explicit instruction, "shall we
tackle - User & Team Workload 1/8. - 7 metrics, none previously
tracked," at which point 0428 built all seven together, the operator's
own choice over building them one at a time. Decisions 0415, 0416,
0418, 0419, 0420, 0421, 0422, 0423, 0424, 0425, 0427, and 0428 each
built one or more vertical slices for real — Workload's own throughput
metric and — 0428's own remaining seven — open tasks by user, average
handling time, claim-to-complete cycle time, tasks pending over a
period, team queue depth, workload balance, and exceptions by user,
Financial Performance's "Accruals report" and "Spend under management
(with PO)," Fraud Prevention's "Potential duplicate invoices,"
"Unapproved-supplier invoices," "Exceptions by type, by user, by
supplier, trended," "Statistical outliers," and "Segregation-of-duties
flags," Supplier Performance's own "Spend by supplier," active
supplier count by status, average cycle time, exception rate and type
mix, PO variance, payment terms held vs. negotiated, and — the last
two, decision 0427 — early-payment discount eligibility and hold
history, the Multi-Enterprise CFO View's
own "Consolidated spend across org units / legal entities" (0425) — the
design's own recommended "Option 1" scoping (`holdsEverywhere`, `GROUP
BY org_unit_id`), chosen directly by the operator over the genuinely
new multi-select org-comparison scope the design itself defers.
Decision 0417 gave all five design screens their own tab inside the
new AP Analytics screen; decision 0425 is the first to give Executive
IQ real content behind its own tab rather than a permission-gated "not
built yet" placeholder. **Spend under management is still also the
Multi-Enterprise CFO View's own *listed primary* screen**, per the
design's own deliberate cross-referencing (0419) — now that Executive
IQ exists, that metric likely belongs there too, not built there yet.
**The Multi-Enterprise CFO View's own other five metrics** —
liabilities and accruals by entity, cash position across currencies,
cross-entity supplier concentration, cross-entity exception and
fraud-signal trend, and cross-org throughput/workload comparison — stay
unbuilt, each named as a declined option in decision 0425's own
first-metric question. **The genuinely new "compare selected orgs"
scoping concept (the design's own "Option 2") stays exactly where the
design document leaves it** — a decision for a future design pass, not
assumed solved by decision 0425's own Option 1 build. **Liabilities &
Accruals' own other four metrics** — invoices eligible for early
payment / dynamic discount, payment history, cash-flow forecast (and
by currency), and payment terms held vs. actual with the resulting DPO
trend — stay unbuilt; three of them need payment-execution data (when
and on what terms an invoice was actually paid) this codebase does not
capture anywhere. **Worth noting for whoever picks this screen up
next: the design's own wording for "invoices eligible for early
payment / dynamic discount, by volume and by amount" here is close
kin to Supplier Performance's own "early-payment/discount capture
rate," which decision 0427 built, honestly narrowed, as
per-supplier eligibility (`GET /suppliers/discount-eligibility`,
grouped by currency) — the same underlying `discount_pct`/
`discount_days` fields and open-invoice query, aggregated by supplier
rather than by volume/amount. Not built here, and not assumed
equivalent without checking — but the data behind it already exists,
which the other three of this screen's metrics do not.
**Fraud & Risk Detection has five of its own six metrics built now —
only vendor banking-detail-change alerts stays unbuilt**, the design's
own words: "not currently captured by VibeFinance... noted as a real
gap, not assumed solvable" — no field anywhere in this codebase
records a supplier's banking details changing, only their current
value. Decision 0422 built the second of the six, unapproved-supplier
invoices; decision 0423 built the third, exceptions by type, by user,
by supplier, trended; decision 0424 built the fourth and sixth
together, statistical outliers and segregation-of-duties flags, at the
operator's own request ("Can you tackle 1 and 2").

**Screen 6 — "Talk to an AP Expert," entirely unbuilt, no vertical
slice started.** The design's own sixth and last dashboard addition: a
conversational tab answering plain-language questions about live AP
data — *"what's our overdue balance with Acme this month"* — without a
person having to find the right screen or report first. Gated on a
new, dedicated `AP.Assistant` permission, deliberately not implied by
any existing grant. Architecturally a small, reviewed set of named
tool calls, each running through the same `hasPermission`/`unitClause`
checks as the screen it stands in for — explicitly **not** open
text-to-SQL against D1. The design's own Recommended Phasing sequences
it last, Phase 5, on purpose: its tool palette wraps the scoped query
functions the other five screens' own routes already build, so it has
the least to stand on until they exist. A further "standalone remote
MCP server" option the design also sketches for this screen is
explicitly out of scope for the document itself, not merely deferred —
its own future decision, should it ever be made.

**~~Early-payment/discount eligibility, specifically, is parked.~~
Built, honestly narrowed, as eligibility rather than the design's own
literal "capture rate" (0427).** This paragraph's own investigation —
that a real discount offer ("2% if paid within 10 days") was captured
nowhere in structured form, and that the operator's own instinct
(terms belong on the supplier record, not per-invoice) was right in
principle but blocked by `suppliers.payment_terms` being free text
only — is what the operator was asked to resolve directly: add
structured `discount_pct`/`discount_days` fields to `suppliers`
(migration 0072), CSV-loadable like `payment_terms` already is. **But
structured fields alone still don't reach "capture rate."** The
design's own literal metric needs to know whether a discount was
actually *taken* — payment-execution data (when and on what terms an
invoice was actually paid) this codebase has never captured anywhere,
the same gap that blocks Liabilities & Accruals' own "payment history"
below. Surfaced to the operator directly, who chose the honestly
narrower framing: report which currently-open invoices sit inside
their supplier's discount window today (`GET
/suppliers/discount-eligibility`), not a historical capture rate. The
literal "capture rate" metric itself stays unbuilt, for the
payment-execution reason above — the eligibility framing is a
deliberately different, honestly-labeled metric, not that metric
finished.
**~~Hold history was a different shape of gap — no audit trail existed
for any supplier field.~~ Built, on a new general mechanism, not a
hold-specific table (0427).** `suppliers.on_hold` and
`suppliers.hold_reason` (migration 0049) were current state only, and
three separate write paths reach `suppliers` — CSV mirror-load
(`load-suppliers.ts`, which can silently flip `on_hold` on every
reload), the hand-edit route, and the hold/release route — a fact
investigated directly before design, and the reason the operator was
asked (and chose) the broader of two real options: not a narrow
hold-only history table, but a general field-change audit trail
(`supplier_field_changes`, migration 0072) covering all three write
paths and every editable/settable field, not only hold. Deliberately
kept separate from decision 0350's own pre-existing
`detectSupplierChanges` mechanism (which watches a narrower field set
to spawn Supplier Maintenance review tasks, and is untouched by this
change) rather than repurposing it. `GET /suppliers/hold-history`
pairs each `on_hold` 0→1/1→0 transition into a discrete period, with
its `hold_reason` at the time; a supplier held since its very
first-ever load (no prior row to diff against) has no recorded period
at all, honestly, rather than backfilled.
Decision 0421 built six of this screen's eight key metrics; decision
0427 built the last two — Supplier Performance is now the first of the
six design screens with all of its own key metrics built.

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
| `vf-app` | 2233 |
| `vf-licence` | 320 |
| `vf-ui` | 74 Worker · 873 browser |
| `shared` | 287 passing, 3 known pre-existing failures |

Both migration chains replay clean with every standing invariant
holding — 72 migrations for `vf-app`, 138 for `vf-licence`.

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
| `docs/decisions/` | 401 decision records | Current |
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
