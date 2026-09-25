# 0485 — Which stages the Stage Restrictions screen even offers

**Status: built and verified locally, not yet committed/pushed at the
time of writing.** No push access from this session — delivered as a
git bundle, per this repo's own established handover mechanism.

---

## What was asked

Reported live, in the same message confirming decision 0484's deploy:
*"the new UI Stage Restrictions exposes some configuration options
that will never actually happen, because they are not queues that
should permit this configuration. For example; Intake - only used
transitionary so that invoices can be extracted from a source. Payment
Eligible; this is another queue pending delivery to the ERP and cannot
be retrieved from. Approval, there are business reasons / segregation
of duties why you might not want to allow this. AP Review; arguably
after coding and approval has taken place, changing the coding should
not be permitted. I have unchecked the boxes for now, but makes me
wonder whether the default case should be off, or perhaps we limit the
stages where this can be configured in the screen? Thoughts?"*

## What was found and decided

Two candidate fixes, weighed directly against each other:

**Flip the default to off.** Rejected. The field-visibility system's
restrict-only invariant (`handleSetStageFieldVisibility` hard-refuses
a stage trying to grant `edit`, per decision 0114) is load-bearing
precisely because a stage can only ever tighten what a customer
already allowed. A default of "off" is not a restriction in that
sense — it is a grant a screen would need to make before anything
could be configured at all, the exact shape that invariant exists to
prevent screens from doing casually. It would also silently change
behaviour for every stage already relying on today's default the
moment this shipped.

**Limit which stages the screen offers, via an explicit per-stage
flag.** Chosen — put to the operator directly via `AskUserQuestion`
against an inferred heuristic (guessing from `rule_set_id` nullness or
`required_permission` absence), and selected. Neither heuristic
reliably signals "no person can ever key a line at this stage," and
guessing wrong in either direction is a real cost: hiding a stage that
genuinely needs configuring one day (Approval, AP Review — the
operator's own business-reason case), or leaving a checkbox visible
that can only ever mean "restrict" on a stage that was never
reachable (Intake, Payment Eligible). This is the same lesson decision
0484 taught this project the hard way, in a different list: an
inferred or incomplete list silently misses the case that matters. An
explicit flag, set once by an operator who knows their own process, is
the only shape that does not risk either failure mode.

**Defaults to offered (1), not restricted (0)** — the field-visibility
system's own `UNCONFIGURED = hidden` reasoning run in reverse: nothing
currently visible in the Stage Restrictions screen should silently
disappear the moment the new column lands. An operator turns it off
for the stages that do not apply, once — the same "a person activated
this" discipline every other opt-out in this schema already follows.

## What was built

- **`migrations/0081_stage_offers_field_restrictions.sql`**:
  `process_stages.offer_field_restrictions INTEGER NOT NULL DEFAULT 1
  CHECK (... IN (0, 1))`, following `0041_read_only_stage.sql`'s exact
  precedent shape. Both existing `INSERT INTO process_stages` call
  sites (`process-route.ts`, creating a live stage and a draft stage)
  use explicit column lists that omit this column, so the `DEFAULT`
  applies automatically — neither needed a change.
- **`workers/vf-app/src/field-visibility-route.ts`**:
  `handleSetStageOffersFieldRestrictions(db, stageId, offer)` — the
  same shape as the sibling `handleSetStageReadOnly`: 400 on a
  non-boolean `offer`, 404 on a stage that does not exist, otherwise
  `UPDATE ... SET offer_field_restrictions = ?` and a small body back.
- **`workers/vf-app/src/index.ts`**: `PUT /processes/stages/:id/offer-
  field-restrictions`, gated on `Admin.Configure` like every sibling
  stage-property route.
- **`workers/vf-app/src/process-route.ts`**: `StageDetail` gains
  `offerFieldRestrictions: boolean`; `stagesAtVersion()` selects and
  maps `offer_field_restrictions`. Carried on the same read
  `processes.js` and the Stage Restrictions tab already both call,
  rather than a second route only one of them would use.
- **`workers/vf-ui/src/index.ts`**: the matching entry added to
  `PROXIED_TO_INSTANCE` **in this same change**, not after a live
  report — decision 0484 was the lesson, applied this time before
  shipping rather than after.
- **`workers/vf-ui/public/ap-setup.js`**: `stageRestrictionsTab()` now
  reads `stage.offerFieldRestrictions` per stage (`undefined` reads as
  offered, matching the column's own default) and branches each
  panel's body: offered shows the existing three Account Coding
  checkboxes unchanged, plus a new "Offer Account Coding restrictions
  for this stage" toggle; not offered shows a short explanation in
  their place instead. The toggle itself, `setStageOffersFieldRestrictions`,
  follows the same auto-save-on-toggle, revert-on-failure pattern as
  every other checkbox on this tab.
- **`workers/vf-licence/migrations/0166_stage_offers_restrictions_strings.sql`**:
  the toggle label and the not-offered explanation, en/de.
- Tests: `workers/vf-app/test/stage-offers-field-restrictions.test.ts`
  (new — 400/404/success/independence-from-other-stages for the
  handler), two new cases in `process-route.test.ts` (default true on
  a new stage; a stage turned off reads back false), a new `describe`
  block in `workers/vf-ui/test-browser/ap-setup.test.ts` (offered vs.
  not-offered rendering, both toggle directions, save-failure revert),
  the new route added to `workers/vf-ui/test/index.test.ts`'s
  `CALLED_BY_A_SCREEN`.

## A pre-existing gap found and fixed alongside this one

While wiring migration 0166 into `workers/vf-licence/test/setup.ts`,
found that migrations 0163–0165 (decisions before and including 0483)
had never been added to that file's own import/exec list at all — the
test `CONTROL_DB` was missing three real migrations' worth of strings,
silently, because `string-coverage.test.ts`'s own hand-kept
`KEYS_THE_INTERFACE_USES` list also never had decision 0483's new keys
added, so nothing exercised the gap. Fixed both: the three missing
migrations (plus 0166) are now applied in `setup.ts`, and decision
0483's eight keys plus this decision's two are now in
`KEYS_THE_INTERFACE_USES`. Not a backfill of every other possible gap
in that list — named here rather than silently left, matching decision
0444's own precedent for a pre-existing gap found mid-way through
unrelated work.

## What was not built

No change to the field-visibility restrict-only invariant itself, and
no change to any existing stage's configured restrictions — this is
additive, screen-only scope. The "second optional rule set per stage"
design for allowing matching-in-validation remains its own deferred,
unbuilt decision, untouched here.

## Verification

- `workers/vf-app`: `stage-offers-field-restrictions.test.ts` (6/6),
  `process-route.test.ts`, `field-visibility.test.ts`,
  `read-only-stage.test.ts` together — 107/108 on first pass (one
  self-inflicted sequence collision in a draft version of this test
  file, fixed before the final run), **all green** on the run that
  matters. `tsc --noEmit` shows no new errors in any touched file (the
  repo-wide `cloudflare:test` noise pre-exists on unmodified `main`,
  confirmed via `git stash`).
- `workers/vf-ui`: worker suite **74/74**; browser suite **1117/1118**,
  the one failure a pre-existing, unrelated `document-window.test.ts`
  rejection confirmed via `git stash` to be present identically on
  unmodified `main`.
- `workers/vf-licence`: `string-coverage.test.ts` +
  `ui-strings.test.ts` together — **32/32**. The full `vf-licence`
  suite did not finish inside this session's time budget (matching
  this repo's own established pattern of running targeted files rather
  than the full, slow suite for this worker); nothing touched here
  falls outside the two files run.

## Still to do, operator side

Push and deploy all three workers (`vf-app`, `vf-ui`, `vf-licence`) and
apply migrations 0081 (`vf-app`) and 0166 (`vf-licence`). Once live,
turn the new toggle off for Intake and Payment Eligible — the two
stages named in the original report — and leave Approval and AP Review
offered, since restricting Account Coding there was named as a real,
wanted business decision rather than a configuration that can never
apply.
