# 0480 — May Not Leave the Last Checkpoint Without a Supplier the ERP Knows, and New Seller

**Status: built and verified locally, not yet committed/pushed at the
time of writing.** No push access from this session — delivered as a
git bundle, per this repo's own established handover mechanism.

---

## What was asked

In the operator's own words: *"I would like, when an invoice is
received, for the Seller, and Buyer records to me identified at the
validation stage. If the seller cannot be found, and it is a new
invoice, we should provide a New Seller, so that the user can Enter in
the Company Name, Tax ID, E-mail address, and Address... This will be
a Non-PO invoice, and stop in coding and approval stages. But it
should stop in the AP Review stage. This is the final stage before
releasing to the ERP system, which cannot happen until an ERP
Identifier for the Supplier is recorded. For PO Invoices, an invoice
with an unidentified supplier should not happen... For PO to be
approved and released, the Supplier would need to have been setup
first."*

Two design questions this raised were settled by AskUserQuestion
before any code was written: whether the ERP-release gate is a
platform guarantee or a tenant-configurable rule — **hardcoded**,
because "you may not release to the ERP without a supplier it knows
about" is not a business policy a customer's own rule author should be
able to turn off; and how a PO invoice with no supplier should behave
— **blocked distinctly, with no self-service New Seller offered**,
since the operator's own words treat that case as a data problem
needing investigation, not an ordinary new supplier.

## What was decided

**One hardcoded, structurally generic gate, not a check tied to any
named stage.** `erpReleaseGuard()` fires wherever an invoice is about
to leave the last stage that still has a rule set behind it — whenever
the next stage has no `rule_set_id` of its own, or there is no next
stage at all. For this tenant's real process shape that lands exactly
on `review → payment-eligible`, matching the operator's own words
("the final stage before releasing to the ERP system"), without the
gate ever naming "review" by id — a process reshaped later still gets
the same guarantee at whatever its own last real checkpoint turns out
to be.

**Reads facts, not a live database join — reversed from this
decision's own first draft, on what real tests caught.** The first
version read `invoice_headers.supplier_id` and `suppliers.erp_identifier`
live via a JOIN, on the reasoning that a live read is more robust than
trusting facts (motivated by a real staleness bug found while tracing
this, see below). Running the real test suite proved that reasoning
backwards: decision 0434's own architecture
(`docs/decisions/0434-...md`, `source-capture-route.ts`) computes
`supplier.matched`/`supplier.awaitingErp` as **facts**, fed into the
same cascading `visitCurrentStage` call a fresh capture triggers — and
the durable `invoice_headers.supplier_id` write happens strictly
*after* that whole cascade returns, "so a cascading visit can carry a
fresh instance clean through Validation, Matching, Coding and Approval
to `completed` in that one call" (that function's own comment). A
guard reading live DB state during that same cascade always sees a
stale or null `supplier_id` on a clean invoice's very first capture —
which would have blocked every ordinary clean invoice in production,
not just the ones this gate exists for. Fixed by reading
`facts["supplier.matched"]` / `facts["supplier.awaitingErp"]` instead
— exactly what every rule at every earlier stage already evaluates
against — with a cheap `SELECT 1 FROM invoice_headers WHERE id = ?`
existence check kept alongside it, so a synthetic or not-yet-written
invoice is never blocked on a supplier record it has no row for at
all.

**Three system reasons, not two.** A first pass conflated "nothing
matched at all" with "matched to a local placeholder still awaiting
its ERP identifier" — found wrong via a specific existing test
scenario (`source-capture-workflow.test.ts`'s genuinely-unmatched
case) that the two-reason vocabulary mislabeled. `supplier_unidentified`
(nothing matched — the New Seller case), `supplier_awaiting_erp` (a
real local record exists, decision 0231, but the ERP has not given it
an identifier yet), and `po_supplier_unidentified` (a PO invoice with
no supplier matched at all — the anomaly, no self-service) are now
distinct, mutually exclusive by construction with a rule-fired task's
own `rule_id`.

**Never throws — matches the file's own established convention.**
`erpReleaseGuard` returns `Promise<number | RouteResult>`, the same
shape every other guard in `workflow-engine.ts` (`orgGuard`, etc.)
already uses, rather than throwing. A throw would have crashed the
whole capture request outright, bypassing decision 0435's own existing
masking (a `visitCurrentStage` failure is recorded as a
`workflow.stageError` fact, but the capture route's own HTTP response
stays 201 regardless — "the invoice genuinely was stored, and changing
that status would risk a caller... treating a stored document as
lost").

**No self-service for the PO anomaly, by the operator's own
invariant.** `hasPoReference` (a trimmed, non-empty BT-13) suppresses
the New Seller button entirely and shows a distinct warning instead —
registering a company for a PO invoice with no supplier would paper
over what is actually a data problem, not solve one.

## What was found while building it

Already covered above in detail (the live-read reversal and the
missing third reason) — both caught by running the real test suite,
not by review.

**`handleSetInvoiceSupplier` (`load-suppliers.ts`, decision 0222's
attach-by-hand route) previously wrote `supplier.matched` /
`.chosenBy` alone**, leaving `supplier.awaitingErp`, `.onHold`,
`.paymentTerms`, `.matchOption`, and both tolerances exactly as they
were before attaching — which, for a previously-unmatched invoice,
means their old defaults (`false`/`null`). A newly-attached supplier
still awaiting its own ERP identifier therefore read as
`supplier.awaitingErp: false` — exactly wrong, and exactly the fact
this decision's own gate depends on. Fixed to refresh every
supplier-derived fact in one `json_set(...)` UPDATE, mirroring
`buildIntakeEnricher`'s own computation deliberately (that function's
own comment already says the two must be kept parallel). Real,
necessary, and independent of the gate itself — `followUpAfterTaskCompletion`
(`index.ts`) depends on it for correctness on any re-visit.

## What was built

- **`migrations/0080_task_system_reason.sql`**: `tasks.system_reason`
  (nullable `TEXT`, `CHECK` against the three values above). Point-in-time
  assertion (no task has one yet) and a standing invariant (never both
  `rule_id` and `system_reason` set on the same task — the same
  discipline decision 0478 already established for one answer to "why
  is this task here," extended to the engine-created kind too).
- **`workers/vf-app/src/workflow-engine.ts`**: new `erpReleaseGuard()`,
  wired into both branches of `visitCurrentStage`'s cascading loop
  (the automatic-stage path and the rule-bearing path) right where
  each computes what stage comes next — before advancing or completing,
  never after. Creates its own task via the existing `handleCreateTask`,
  owned by the hardcoded `"ap-team"` (defensible for this tenant's own
  single database per decision 0001's confirmed single-tenant-per-deployment
  architecture — not a platform-wide assumption), required permission
  falling back to `stage.required_permission ?? "AP.Review"` since the
  reason a task lands here is always "the ERP cannot be told about
  this yet," AP Review's own remit in the operator's own words.
- **`workers/vf-app/src/load-suppliers.ts`**: `handleSetInvoiceSupplier`
  rewritten as described above.
- **`workers/vf-app/src/invoice-facts-route.ts`**: `currentOpenTaskReason`
  extended with a `UNION ALL` combining decision 0478's rule-attributed
  open task with this decision's engine-created (system-reason) kind,
  most recent by `created_at`, whichever it is — a new `systemReason`
  field on the response, `name` left as the raw code for a
  system-reason row (the frontend resolves it through `t()`).
- **`workers/vf-ui/public/viewer.js`**: `reasonLinePanel()` extended
  with a branch resolving `workflow.systemreason.<reason>.name` when
  `systemReason` is set. `sellerPanel()`'s unmatched branch gained the
  `hasPoReference` gate, the distinct PO-anomaly warning, and the New
  Seller button (hidden when `hasPoReference`). New `openNewSellerForm()`
  — pre-fills company name (BT-27), VAT id (BT-31), and country
  (BT-40) from the document; also takes email and address by hand, per
  the operator's own named fields — `handleCreateSupplier` has always
  accepted them even though decision 0222's own `alsoOffer` secondary
  button never asked for them. `POST /api/suppliers` then
  `PUT /api/invoices/:id/supplier`, then closes and reopens the viewer
  on the same task, the same two-step shape `openSupplierSearch`'s own
  `alsoOffer` already uses. Additive beside `openSupplierSearch()`
  (decision 0222/0233) — that one finds an existing supplier automatic
  matching missed; this one records one that genuinely is not on file.
- **`workers/vf-licence/migrations/0164_new_seller_and_erp_release_strings.sql`**:
  New Seller form strings and the three system-reason banner names,
  EN/DE, 20 rows.

## What was not built

No separate PO/seller identity cross-check inside `computePoMatch()`
— a real, named follow-up, not this decision's own scope; this gate
only blocks release, it does not attempt to detect a PO/supplier
mismatch that matching itself missed. No retroactive backfill: an
invoice already sitting at AP Review before this ships gets no
`system_reason` until it is next visited. No change to the hardcoded
`"ap-team"` id becoming a real configuration point — flagged, not
fixed, consistent with how this session has treated every other
tenant-specific hardcoded id found along the way this session.

## Verification

`workers/vf-app/test/workflow-engine.test.ts`: new describe block,
**8 new tests** — releasable pass-through (no task), matched-but-awaiting-ERP
block (system_reason + correct owner/permission), the stage's own
`required_permission` overriding the fallback, the Non-PO
unmatched-at-all block (`supplier_unidentified`), the PO-anomaly block
(`po_supplier_unidentified`), a non-invoice subject never gated, an
invoice id with no `invoice_headers` row never gated (the existence
check), and idempotency (one task, second visit refused — decision
0072's own re-visit guard, reused unmodified). **68/68** in the file.

`workers/vf-app/test/load-suppliers.test.ts`: **2 new tests** —
`handleSetInvoiceSupplier` refreshes every supplier-derived fact (not
just `.matched`), and sets `supplier.awaitingErp` correctly for a
local (ERP-less) supplier. **142/142** in the file.

`workers/vf-app/test/key-fields.test.ts`: **3 new tests** for
`currentOpenTaskReason`'s system-reason branch — surfaces an
engine-created task's reason with no rule behind it, distinguishes all
three reasons, and picks the most recently created open task whichever
kind it is. One pre-existing test updated for the response's new
`systemReason: null` field on a rule-attributed reason. **59/59** in
the file.

A further ~10 pre-existing tests across `index.test.ts`,
`intake-capture-route.test.ts`, `invoice-org.test.ts`, and
`source-capture-workflow.test.ts` were updated on a per-test basis —
supplier facts added to tests unrelated to supplier matching (the
majority), or assertions corrected to the new, correct blocking
behaviour for the minority genuinely about an unmatched supplier.

Batch run across `approval-hierarchy.test.ts`, `ar-process.test.ts`,
`expense-process.test.ts`, `index.test.ts`, `invoice-org.test.ts`,
`stage-permissions.test.ts`, `unit-config.test.ts`,
`load-suppliers.test.ts`, `intake-capture-route.test.ts`,
`source-capture-workflow.test.ts`, `source-capture.test.ts`,
`workflow-engine.test.ts`, `key-fields.test.ts`,
`invoice-facts-route.test.ts`: **618/619** — the one failure is
`stage-permissions.test.ts`'s pre-existing, unrelated closed-permission-set
finding (missing `AP.Manager` from a SQL list), confirmed present on
unmodified `origin/main` via `git stash` before any of this decision's
changes were applied. `tsc --noEmit` shows no new errors in any
touched file.

`workers/vf-ui`: `test-browser/viewer.test.ts` **195/195** (7 new —
New Seller button shown/hidden by `hasPoReference`, a blank BT-13
treated as none, prefill from BT-27/BT-31/BT-40, the empty-name
refusal, the full save-then-attach flow with call ordering asserted,
and a save-failure shown inline without closing the form). Full
browser suite (`vitest.browser.config.ts`) **1099/1100** — the one
failure is `typography.test.ts`'s pre-existing, unrelated hardcoded-`10px`
finding in `.collabchip .activityavatar` (decision 0470, untouched
here), confirmed present on unmodified `origin/main` via `git stash`.
The pre-existing ~214–226 unhandled-rejection warnings in
`viewer.test.ts` (stale fetch-mock rejections from earlier describe
blocks' own local stubs, firing after their own test completed —
`collaborators.js`/`activity.js`/`pages`) are the same class already
documented in decision 0478 and unrelated to this decision — confirmed
by running the identical test file against this session's changes
fully reverted (`git stash`) and observing the identical 188/214
passed/errors baseline before any of this decision's own new tests
were added.

## Still to do, operator side

Push and deploy (`vf-app`, `vf-ui`, and a `vf-licence` migration all
involved; `shared` untouched). Apply migration `0080` against
`vf-app-poc` and migration `0164` against `vf-licence-poc`. No data
migration, no re-authoring required — an invoice already at AP Review
gets no `system_reason` until it is next visited, and every other
invoice already carrying `supplier.matched`/`supplier.awaitingErp`
facts is evaluated correctly the first time this ships.
