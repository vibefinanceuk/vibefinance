# 0029 — Intake capture

Status: settled, 1 September 2026. The largest, most-repeated gap in
this project — flagged across decisions 0013, 0015, 0019, 0023, 0024,
0025, and 0026 without ever being closed. This closes the
orchestration piece of it.

## The boundary that had to stay intact

The workflow engine has been deliberately, repeatedly agnostic about
where facts come from — decision 0019's own explicit choice, restated
by 0025 and 0027. Whatever intake capture does, it could not become a
special-cased stage type with document logic baked into the engine
itself; that would quietly undo a principle every subsequent decision
went out of its way to preserve. Capture happens entirely upstream of
`visitCurrentStage`, producing ordinary facts the exact same shape
everything else already uses.

## Almost entirely reuse, not new evaluation logic

Working through the design surfaced that "minimum standards → forward,
else block for review" needed no new mechanism at all — a rule-bearing
stage firing `assign_task` already blocks; a stage that fires nothing
already advances on its own (decision 0018/0019's existing cascade).
The one genuinely new piece is orchestration: store facts
(`handleUpsertInvoice`, unchanged), create an instance for the
channel's own process (`handleCreateProcessInstance`, unchanged),
visit it immediately (`visitCurrentStage`, unchanged) — as one
continuous call rather than three a caller previously had to chain
themselves. Since a channel already knows which process it belongs to
(decision 0024), capturing through one determines the process
automatically; `mandate.channel` defaults to the channel's own name
unless explicitly overridden.

## A real correction to the first design, made before anything was built

The first framing of this proposed a "minimum standards" rule set at
Intake itself. That was wrong, corrected directly in conversation:
content quality is Validate's job, not Intake's — Intake's only
concern is *which channel* something arrived through, never whether
what arrived is any good. Two genuinely different kinds of failure,
kept structurally separate:

- **Structural failure** — no id, or `facts` isn't a valid object.
  Nothing to route or review; rejected outright, no instance created
  at all.
- **Content thinness** — the document arrived fine, it just has gaps.
  This *does* successfully become an instance, advances *through*
  Intake normally, and only gets caught downstream at Validate by a
  customer's own rule set — exactly the review/correct/enrich
  workflow the person described. Proven directly: a thin document with
  no structured fields at all still reaches `completed` when nothing
  downstream checks for them, and correctly blocks at a real Validate
  stage when a rule does.

## A real bug this bundle's own tests caught, the same class found once before

`intake-capture-route.ts` originally passed the *raw* inline `facts`
to `visitCurrentStage`, not the structured fields (`supplierVatId` and
the rest) that had just been stored — the exact same class of gap
decision 0028 found once already in `/rules/evaluate`. Caught by this
bundle's own test suite, not assumed safe: a Validate-stage test
expecting a populated `BT-31` to sail through instead blocked
incorrectly, revealing the merge had never happened. Fixed properly
this time — `mergeStructuredInvoiceFacts` was extracted out of
`index.ts` into a shared function in `invoice-facts-route.ts`, used by
both `/rules/evaluate`'s own persisted-facts loading *and* this
bundle's capture path, so the same correctness bug can't hide in a
second, separate place again. Proven both directions: the merge was
deliberately reverted and the exact same test failure reproduced
before the fix was restored.

## Analytics led with a real endpoint, not "query D1 directly"

`intake_capture_events` records every capture *attempt*, accepted or
rejected — the same append-only discipline `invoice_runs` and
`stage_visits` already established. Rejections previously left no
trace anywhere; "exceptions" would have been invisible to any future
analytics. `GET /processes/:id/intake-stats` returns real
volume/exception counts per channel — the first `GET`/read endpoint in
this system, built because it was explicitly asked for rather than
left as the project's usual "raw API for now" default. Proven
directly, including the easy-to-miss aggregation edge case: a channel
with zero events reports `0`/`0`, not `NULL` — SQL's `SUM` over an
empty group would otherwise silently produce the wrong shape.

## What's still open

- **Real document parsing itself** — this bundle accepts
  already-extracted facts, the same shape `POST /invoices` always has.
  Genuine UBL/XML parsing, and the harder PDF/receipt extraction cases,
  remain the deferred, "real domain modeling" piece decision 0026
  already named.
- **Per-event exception detail via the API** — `intake-stats` reports
  counts; the individual `reason` on each rejected event is still a
  direct-query-only concern, matching the "raw API for now" precedent
  everywhere else in this project.
- **`GET /processes/:id/intake-stats` is unauthenticated** — matching
  the administrative-visibility reasoning already applied to
  `/processes` and `/processes/:id/stages`, but worth revisiting once
  real customer-facing dashboards exist.
- The document/receipt ingestion path's harder half (real extraction)
  remains the single largest unbuilt piece in this project.
