# 0469 — Two-Way Matching Exceptions and Non-PO Approval Routing, Phase 1

**Status: built and verified locally, not yet committed/pushed at the
time of writing.** No push access from this session — delivered as a
git bundle, per this repo's own established handover mechanism.

---

## What was asked

Explicit approval to begin building, following the investigation and
design settled across decisions 0464–0468: *"yes please"* to a phased
build plan, then confirming Non-PO Approval routing is in scope for
this phase (*"Non-PO Approval Routing should be part built. We have
under the AP Setup already configured a framework for Employee-
Supervisor and Cost Centre approvals."*), and confirming the toggle's
own safety understanding directly: *"a toggle would only impact items
not already past that stage... Is that what the question infers?"* —
confirmed exactly correct, since `resolveApprovalHierarchy`/
`resolveApprovalTargets` only ever run once per stage-visit at
task-creation time.

Phase 1's own scope, as settled by 0464–0468: the schema for matching
exceptions and Business User collaboration; the four split vocabulary
facts distinguishing "not found" from "found and disagreed"; org-wide
matching tolerance and quantity-matching toggle, superseding a real,
silent `?? 0` gap found in `po-matching.ts`; the `Procurement.*`
permission pair, reserved; and Non-PO Approval routing itself, additive
ahead of whichever mode is configured.

## What was found

**A real, silent gap, not a hypothetical one.** Before this phase,
every supplier without an explicitly configured `amountTolerancePct`/
`quantityTolerancePct` fell back to a hard-coded `?? 0` (exact match)
in both `computePoMatch` and `computePoLineMatch` — whether that was
ever a deliberate decision for that supplier or not. `org_matching_config`
gives every org a configurable default instead, itself defaulting to
`0` so nothing changes for any supplier until an operator sets it
deliberately — confirmed by migration replay and by a dedicated test
proving the org default is genuinely read, not silently ignored.

**`resolveApprovalTargets`, not `resolveApprovalHierarchy`, is
`workflow-engine.ts`'s own real front door.** The Non-PO precondition
had to be checked in both, not one: `resolveApprovalTargets` calls
`resolveCostObjects` directly for Cost-Object mode, bypassing
`resolveApprovalHierarchy` entirely, so a check placed only inside the
singular resolver would silently never apply under Cost-Object mode.
Both now call a single shared `resolveNonPoRequester` helper first,
so a Non-PO invoice with a known requester routes to them the same way
regardless of which entry point a caller uses.

**No route yet populates `invoice_collaborators`.** The "Add person to
conversation" UI is later-phase scope, named as such in decision
0468's own "what was not built." `resolveInvoiceRequester`
(`workflow-engine.ts`) queries it correctly today and will simply find
nothing until that UI ships — genuinely inert, not a placeholder to
revisit before it does anything, the same "wired correctly, dormant
until its dependency exists" shape the `route_non_po_to_requester`
toggle itself already has. Nothing in `invoice_collaborators`
distinguishes a primary requester from any other collaborator; the
earliest-added one is used as a reasonable default, flagged directly
in code as worth revisiting once real usage exists to judge it
against, not before.

## What was built

- **Migration `0078`** (`buyer_user_id` on `purchase_orders`;
  `invoice_collaborators`; `org_matching_config` singleton;
  `org_approval_config.route_non_po_to_requester`) — every new setting
  defaults to exactly what already happens today. Also restates the
  permission-vocabulary standing invariant (decision 0200, previously
  restated by migrations 0062/0063/0066/0071/0074) with
  `Procurement.Collaborate`/`Procurement.Approve` added, since this
  migration is what introduces them. Replayed clean: 78 migrations,
  184 standing invariants, all held.
- **Four new derived vocabulary facts** (`shared/interpreter/vocabulary.ts`):
  `po.line_reference_found`, `po.line_price_matched`,
  `po.line_quantity_matched`, `po.line_unit_mismatch`. `po.line_matched`
  itself is completely unchanged — still the same AND of price and
  quantity, still what every existing rule and test depends on — these
  split what it collapses, so a rule can route "PO line not found"
  differently from a price or quantity disagreement, per decisions
  0464/0466.
- **`po-matching.ts` generalized, not rewritten**: `getOrgMatchingConfig`
  reads the new singleton once per `mergePoMatchFacts` call (not once
  per line); `computePoLineMatch`/`computePoMatch` take it as an
  optional parameter defaulting to the exact pre-0078 behaviour, so
  every direct unit test written before this decision keeps working
  unchanged unless it explicitly opts in. `quantity_matching_enabled`
  gates the quantity check off entirely when disabled; unit mismatch is
  now its own surfaced fact rather than silently reading as "quantity
  agreed."
- **`Procurement.Collaborate`/`Procurement.Approve`** (`permissions.ts`),
  reserved — no route enforces either yet, the same starting state
  `AP.Match`/`AP.Code` both had. Split the same way `AP.Validate`/
  `AP.Approve` already are: Collaborate for viewing an invoice you were
  added to and posting to its chat; Approve for holding and completing
  an approval task. Also fixed a stale comment: `AP.Code`'s own category
  comment and `PERMISSION_DESCRIPTIONS` entry still said "not yet
  built" months after decisions 0455/0456 made it real and enforced on
  four routes — corrected to name them; `AP.Match` correctly stays
  described as reserved, since its own route-widening is still later-
  phase scope.
- **Non-PO Approval routing** (`approval-hierarchy.ts`): additive,
  checked ahead of mode dispatch in both `resolveApprovalHierarchy` and
  `resolveApprovalTargets` via a shared `resolveNonPoRequester` helper —
  not a fifth `ApprovalMode`, which would have incorrectly implied
  replacing Employee-Supervisor/Cost-Object customer-wide.
  `ResolveApprovalParams` gains `poReferenced`/`requesterUserId`,
  both optional and additive, the same shape `costObjectValues`
  already established for this interface. Resolves only when the
  toggle is on, the invoice carries no PO reference, and a requester is
  already known; any one missing falls through to the configured mode
  unchanged.
- **`workflow-engine.ts` wired to feed it real values**: `poReferenced`
  computed per task from `BT-13`'s presence on that evaluation's own
  facts, the same pattern `costCentreId`/`costObjectValues` already
  use; `requesterUserId` computed once per stage visit (not once per
  task) via a new `resolveInvoiceRequester`, querying
  `invoice_collaborators` ordered by `added_at`, guarded to run only
  when the stage actually uses the approval hierarchy.

## What was not built

Everything decision 0468 already named as later-phase: the real AP
Setup Matching tab UI, the "Add person to conversation" route and UI
(so `invoice_collaborators` stays empty in production for now, and the
toggle stays correctly inert), standard-rule checkboxes, and
`AP.Match`'s own route-widening onto document-open/task-search. No
"primary requester" flag on `invoice_collaborators` — the earliest-
added convention is a default, not a final answer.

## Verification

`shared/interpreter/vocabulary.test.ts` 23/23. `workers/vf-app/test/
po-matching.test.ts` 23/23 (16 pre-existing + 7 new — the four split
facts individually, the org-wide default tolerance actually being
read and still superseded by a supplier-specific one, the
`quantity_matching_enabled` toggle, and the production path through
`mergePoMatchFacts` itself). `workers/vf-app/test/approval-
hierarchy.test.ts` 36/36 (30 pre-existing + 6 new, proving the toggle
off-by-default, the requester route when all three conditions hold, a
PO-referenced invoice still using the configured mode regardless of
the toggle, no requester known falling through, and the precondition
applying under `resolveApprovalTargets`'s Cost-Object path too).
`workers/vf-app/test/workflow-engine.test.ts` 56/56 (53 pre-existing +
3 new end-to-end tests through `visitCurrentStage`). `workers/vf-app/
test/stage-permissions.test.ts` and `test/org-route.test.ts` 142/142
together, confirming the closed permission set stays consistent across
`permissions.ts` and every migration that restates it. `workers/vf-app/
test/index.test.ts` 152/152. Full `workers/vf-app` suite run twice,
unfiltered: 114/114 files, 2750/2750 tests, both times. `migrations/
apply_migrations.py --replay-only` clean. `python3 scripts/check-
citations.py` clean — 468 records, none dangling. `eslint` clean on
every touched file (two pre-existing, out-of-diff findings in
`workflow-engine.test.ts` left untouched, unrelated to this decision).
`tsc --noEmit` shows no new errors — the only findings are the
pre-existing `cloudflare:test` module-resolution noise present across
every `vf-app` test file already, and the same two pre-existing,
out-of-diff lines `eslint` also flagged.

## Still to do, operator side

Push, deploy, and apply migration `0078` once confirmed. Then decide
the sequencing of the remaining later-phase pieces named above — the
real Matching tab UI, "Add person to conversation," and `AP.Match`'s
own route-widening — genuinely separate decisions from this one.
