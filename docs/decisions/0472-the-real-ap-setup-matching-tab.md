# 0472 — The Real AP Setup Matching Tab

**Status: built and verified locally, not yet committed/pushed at the
time of writing.** No push access from this session — delivered as a
git bundle, per this repo's own established handover mechanism.

---

## What was asked

After decision 0471 (the Business Approver role) shipped and was
confirmed pushed and deployed, the operator was asked which of the
remaining named-but-unbuilt items to pursue next: the real AP Setup
Matching tab UI, standard-rule checkboxes, `AP.Match`'s own
route-widening, or removing a collaborator. **The answer: "Can you
attached the build for number 1"** — the real AP Setup Matching tab
UI.

## What was found

**The backend has held this data since migration `0078`
(decisions 0465/0468/0469) — only the route and the screen were ever
missing.** `org_matching_config` (the org-wide default
`amount_tolerance_pct`/`quantity_tolerance_pct`/
`quantity_matching_enabled`) and `po-matching.ts`'s own
`getOrgMatchingConfig` have existed and been read on every
`mergePoMatchFacts` call since that migration — but the singleton row
was reachable only by direct SQL, the exact same "schema and resolver
first, routes later" sequencing decision 0439 originally used for
Approval Hierarchy, and decision 0469's own "What was not built"
section named this tab directly as later-phase, unbuilt scope.

**No UI precedent existed anywhere in this app for editing a tolerance
percentage.** `supplier.amountTolerancePct`/`quantityTolerancePct`
(decision 0209) are populated by the source-capture/validation
pipeline from supplier master data, never edited through a screen.
This tab is the first place in `vf-ui` a tolerance value is entered by
a person, rather than ingested.

**`ap-setup.js`'s own tab bar already had a slot reserved.** `TABS`
already listed `matching` first, `render()`'s `activeSection` map
already dispatched to it, and `placeholderCard("apsetup.matching")`
was the only thing standing in for a real screen — the exact same
`ap-analytics.js`-style placeholder Coding and Approval Hierarchy both
used to be before decisions 0439/0444 built them out.

**A real, if narrow, blast radius: two other browser test files open
`ap-setup.js` for reasons that have nothing to do with Matching.**
`ap-setup.test.ts` is this screen's own file, but `coding-lists.test.ts`
also calls `open()` (to reach the Account Coding tab) with its own,
separate `openApSetupAs` helper and three further inline
`vi.stubGlobal("fetch", …)` blocks — none of which had ever needed to
stub `/api/matching-config`, because nothing fetched it before this
decision. Making the Matching tab's own data load-blocking (the same
"everything the screen needs, ok-checked together" discipline
`overviewResponse`/`configResponse` already use) would have broken
every one of those tests the moment `load()` started fetching a third,
unstubbed route — caught directly by running the suite, not assumed:
`coding-lists.test.ts` went from 32/32 to 1/32 the moment the fetch was
added, confirmed by reverting and re-diffing to rule out any other
cause.

## What was built

- **`matching-config-route.ts`** (new): `handleGetMatchingConfig`
  reuses `getOrgMatchingConfig` directly rather than re-querying — one
  real reader of the row, not two that could drift.
  `handleUpdateMatchingConfig` validates and writes all three fields
  together (422 on a missing/negative/non-numeric tolerance or a
  non-boolean toggle), the same "replace, not merge" discipline
  `handleUpdateApprovalConfig` already holds for its own singleton — a
  save can never silently leave one field's old value in place.
- **`index.ts`**: `GET`/`PUT /matching-config`, gated by
  `Admin.Configure`, the identical gate every other AP Setup route
  already uses — a tab's own gate matches its data's own gate, the
  rule this file's own doc comments already state for `/approval-config`.
- **`ap-setup.js`**: `matchingConfigTab()` replaces
  `placeholderCard("apsetup.matching")` — one form (amount tolerance
  %, quantity tolerance %, a "compare quantity at all" checkbox), one
  Save, the same shape `modeForm` already established for Approval
  Hierarchy's own mode/Default Approver pair. Percentages are entered
  as plain numbers (`5` means 5%), the same unit `org_matching_config`
  and `po-matching.ts`'s own doc comments already use. `load()`'s
  existing `Promise.all([overview, approval-config])` gained a third,
  equally required fetch for `/api/matching-config` — a load failure
  here fails the whole screen the same way an approval-config failure
  already does, not a silently-degraded corner. `placeholderCard()`
  itself is now dead code (every tab is live) and was removed rather
  than left orphaned.
- **One new `ui_strings` migration**, `0160`
  (`apsetup.matchingsub`/`amounttolerance`/`quantitytolerance`/
  `quantitymatchingenabled`/`savematchingfailed`, en/de), wired into
  `vf-licence/test/setup.ts` and required by
  `string-coverage.test.ts`'s `KEYS_THE_INTERFACE_USES`, the same
  mechanism every prior UI-string decision this session already used.
  `apsetup.matching` itself already existed (decision 0440, the tab
  label) and needed no new string — reused as the panel's own header
  too.
- **`coding-lists.test.ts` updated, not just `ap-setup.test.ts`**: a
  new `EMPTY_MATCHING_CONFIG` constant, added to that file's own
  `openApSetupAs` helper's default stub map and to all three
  hand-rolled inline `vi.stubGlobal` blocks that separately enumerate
  routes — the real fix for the regression found above, not a
  workaround. Confirmed by reverting my own changes and re-running:
  32/32 passes unmodified, fails 31/32 with only the route change
  applied, passes 32/32 again once these stubs were added.

## What was not built

**No supplier-specific override UI.** `supplier.amountTolerancePct`/
`quantityTolerancePct` still supersede this org-wide default when a
supplier has one of its own, exactly as `po-matching.ts` already
implements — this tab configures the fallback only, per decision
0468's own scoping; editing a supplier's own tolerance was never named
as in scope here. **Standard-rule checkboxes** and **`AP.Match`'s own
route-widening** — both still separately named, later-phase items from
decision 0469's own backlog, untouched by this decision. **Removing a
collaborator** — still decision 0470's own open gap.

## Verification

`workers/vf-app/test/matching-config-route.test.ts` (new) — **9/9**:
the singleton's own zero-behaviour-preserving default read back
correctly; a write reflected on the next read; all three fields
required together; 422 on a missing or negative tolerance in either
direction and on a non-boolean toggle; a rejected write leaves the
previous configuration untouched (not a partial write). Run alongside
`workers/vf-app/test/index.test.ts` (**165/165**, unchanged — no new
index-level route tests added here, matching this session's own
existing precedent that `/approval-config`'s identical gate pattern
has none either), `po-matching.test.ts` and `approval-config-route.test.ts`
— **227/227** combined, confirming nothing this decision touched
regressed matching or approval-config. `tsc --noEmit` on `vf-app`: one
real error caught and fixed (`OrgMatchingConfig` is not directly
assignable to `RouteResult`'s `Record<string, unknown>` body — fixed
by spreading into a plain object), zero remaining in any file this
decision touched; the same pre-existing `cloudflare:test`
module-resolution noise and `workload.test.ts` implicit-conversion
lines this session already knows about are untouched by this diff.
`eslint` clean on every file this decision touched, backend and
frontend — the one finding surfaced (`ap-setup.test.ts:395`, an unused
`puts` variable) is pre-existing, inside the Cost-Object Priority test
this decision never edited, confirmed by diff. **A full, unfiltered
`vf-app` suite run was attempted and timed out past eight minutes** —
the same known limit decisions 0448 onward already hit; verification
here is targeted, the same discipline those decisions already
established.

`workers/vf-ui/test-browser/ap-setup.test.ts` — **28/28**, the
placeholder tests rewritten into a real describe block: defaults to
0/0/on unconfigured; shows a configured tolerance and a disabled
toggle already filled in; saves all three fields together, asserted
against the actual `PUT` body sent, not just that a button exists; a
failed save surfaces the route's own error text. Full
`vf-ui` browser suite run twice — once revealing the
`coding-lists.test.ts` regression (31/32 failing), once confirming the
fix (32/32) — final full run: **1070/1071**, the one remaining failure
(`typography.test.ts`, a hardcoded `10px` in `app.css`) confirmed
pre-existing by running it against unmodified `HEAD` directly, nothing
to do with this decision. The `document-window.test.ts`/
`viewer.test.ts`/`tasks.test.ts` unhandled-rejection noise decision
0471 already flagged as separate, un-stubbed inline-mock debt is
unchanged by this diff, confirmed by comparing error counts before and
after.

`workers/vf-licence` — full suite, **320/320**, including
`string-coverage.test.ts` (**10/10**) confirming migration `0160` is
applied and all five new keys are both defined and required.

## Still to do, operator side

Push, deploy, and apply migration `0160` (`vf-licence`) once confirmed
— no `vf-app` migration this time, since `org_matching_config` already
existed and was already live; the tab is inert with today's exact
defaults (`0`/`0`/on) until an operator changes a value deliberately.
Which of standard-rule checkboxes, `AP.Match`'s own route-widening, or
removing a collaborator to build next remains an open, separate
choice.
