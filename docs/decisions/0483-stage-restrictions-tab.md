# 0483 — Stage Restrictions: an admin tab for Account Coding per stage

**Status: built and verified locally, not yet committed/pushed at the
time of writing.** No push access from this session — delivered as a
git bundle, per this repo's own established handover mechanism.

---

## What was asked

Reported live: *"I've noticed that the Account Coding feature is
available in the Validation stage, for my non-po invoice. I had not
expected it to be available... Coding should only happen in the
Coding stage and not in the Validation (data accuracy) stage."*

That opened a broader design conversation — whether Account Coding and
PO Matching should be configurable per stage rather than fixed — which
settled on two separate pieces of work: a field-visibility restriction
(this decision) and a second, optional rule set a stage can also
evaluate, for matching-style discrepancy checks (agreed design,
deferred — see "What was not built").

The operator's own follow-up made the business case concrete, not just
tidy: *"I would definitely need the restriction to prevent coding from
validation. That is a business level activity that should be done
only by AP team people. The distinction here is, that a company may
wish to outsource, the document capture and data entry part of the
process. This would mean that coding would need to be turned off at
validation."* A BPO doing Validation's own data entry must never be
able to code an invoice line — that is an AP team decision, not a
data-accuracy one.

## What was found

**Nothing here needed inventing.** `coding.project`,
`coding.commodity_code`, and `coding.gl_code` are ordinary entries in
the same field vocabulary as every BT-xxx field, resolved through the
same customer/stage field-visibility system every other field already
uses (`field-visibility-route.ts`, decisions 0114/0143/0196/0197). A
stage may only ever *restrict* a field further, never grant editing a
customer has not already allowed — that invariant already existed, and
is exactly right for Account Coding: a customer sets it editable once,
for Coding, and any stage that should not have it says so.

**The route to do this has existed since decision 0143/0196, fully
tested, with no screen ever built on top of it** — `PUT /processes/
stages/:id/field-visibility`. AP Setup's own file comments already
named this gap directly: *"no route exists anywhere in this app to
edit a stage's own properties, and inventing one for a single flag was
out of scope for this screen"* (decision 0439's own note, repeated at
decision 0440). This tab is that screen — narrowly, for Account
Coding's own three fields, not a general "restrict any field" picker,
which is a bigger screen for a day something else asks for it.

**One real gap**: the route a screen like this needs
(`GET /field-visibility`) had always omitted hidden fields from its
response, by design — *"a client that received them could render them
by mistake."* Right for the invoice viewer, wrong for a screen whose
whole job is showing a field that is about to be hidden, or already
is, so a person can uncheck (or recheck) it.

## What was decided

**`handleFieldVisibility` gains one opt-in parameter, `includeHidden`,
defaulting `false`.** Every existing caller — the invoice viewer,
`compose.js`, `rule.js` — is unaffected; only the new Stage
Restrictions screen passes it. Extending the existing route rather
than adding a parallel one, the same "derive rather than enumerate"
reasoning decision 0107 already gave for a hand-maintained list.

**Wholesale-replace, read fresh, every time.** `PUT
/processes/stages/:id/field-visibility` replaces a stage's entire
restriction set in one call — right for a route, wrong for a screen
that only ever renders three checkboxes. A save from this tab
re-reads the stage's *complete* current set of stage-level
restrictions immediately before saving, drops the one field just
toggled, and re-adds it only if restricting — so a restriction this
tab does not render a checkbox for (set by the raw API, or a future
screen) is never silently undone by ticking an Account Coding
checkbox. Read again at save time rather than trusted from the last
render, since two people could have this tab open at once.

**A field hidden for everyone, not because of this stage, gets an
explanation instead of a checkbox that could never do anything** — the
restrict-only invariant means checking such a box would have no
visible effect (the customer-level `hidden` still wins), which would
read as a bug. `decidedBy` already answers "why can I not edit this"
(decision 0107's own reasoning again); this screen surfaces it rather
than hiding the distinction.

## What was built

- **`workers/vf-app/src/field-visibility-route.ts`**:
  `handleFieldVisibility` takes a fourth, optional `includeHidden`
  parameter; when true, the hidden-fields filter is skipped.
- **`workers/vf-app/src/index.ts`**: the `GET /field-visibility` route
  reads `includeHidden=1` off the query string and passes it through.
- **`workers/vf-ui/public/ap-setup.js`**: a fourth tab, **Stage
  Restrictions**, alongside Matching/Account Coding/Approval
  Hierarchy. A process picker (shown only when more than one process
  exists), then one panel per stage — its own rule set name (or
  "Automatic"), and three checkboxes, one per Account Coding field,
  auto-saving on toggle the same shape `standardMatchingRulesPanel`
  already established for the Matching tab's own rule checkboxes.
- **`workers/vf-ui/public/app.css`**: two small additions —
  `.stagebadge` (a read-only pill, deliberately not `.chip`, which is
  clickable) and `.sectionlabel` (generalised from `.permissiongroup
  h4`, reused rather than copied a second time).
- **`workers/vf-licence/migrations/0165_stage_restrictions_strings.sql`**:
  eight new keys, en/de. Reuses `field.coding.project`/
  `.commodity_code`/`.gl_code` (migration 0152) directly as this tab's
  own field labels, and `processes.automatic` (already shipped) for a
  stage with no rule set.

## What was not built

**The second piece of the original conversation — a stage optionally
also evaluating another stage's rule set, for matching-style
discrepancy checks in Validation.** Agreed design (a small, contained
schema addition: an optional second rule set per stage, evaluated
alongside the stage's own), deliberately not started here: it touches
the core rule-evaluation path, `process_stages` currently carries
exactly one `rule_set_id`, and rules themselves carry no category to
select "just the matching ones" — a materially different, larger piece
of work from a field-visibility checkbox. Tracked as its own follow-up
decision.

**No general "restrict any field per stage" screen.** The route
already supports any field in the vocabulary; this tab surfaces only
Account Coding's three, since that is what was asked for and what has
a real, named business reason behind it. A general field picker is a
bigger screen for whenever something else needs restricting.

**No data change applied to any tenant's live Validation stage.**
This session has no database access and cannot run the fix itself —
see "Still to do, operator side."

## Verification

`workers/vf-app/test/field-visibility.test.ts`: **29/29**, including
three new tests for `includeHidden` (still omits by default; returns a
hidden field with its `decidedBy` when asked; tells a stage's own
restriction apart from the customer/default one). Batch run with
`key-fields.test.ts` and `load-suppliers.test.ts` (both touch the same
route file's neighbourhood): **230/230**. `tsc --noEmit` shows no new
errors in `field-visibility-route.ts` or `index.ts` (only the same
pre-existing noise elsewhere already documented throughout this
project).

`workers/vf-licence/test/string-coverage.test.ts`: **10/10** —
confirms every new `t(...)` key used in `ap-setup.js` is covered by
the new migration, in both languages, with no typo between the two.

`workers/vf-ui/test-browser/ap-setup.test.ts`: **43/43** (9 new,
covering: the rule-set-name badge and its "Automatic" fallback; all
three fields checked when nothing restricts them; a stage's own
restriction shown unchecked; a customer-hidden field shown disabled
with its explanation rather than a live checkbox; unchecking sends a
`PUT` that both hides the field and preserves an unrelated restriction
this tab does not render (`BT-112`, set some other way); re-checking
sends the restriction removed; a failed save reverts the checkbox and
shows the real error; no process configured shows its own message
rather than an error). Full browser suite: **1111/1112** (the one
failure — an unhandled rejection in `document-window.test.ts`,
unrelated to `collaborators.js` — confirmed pre-existing via `git
stash`, present identically on unmodified `main`).

## Still to do, operator side

Push and deploy `vf-app`, `vf-ui`, and `vf-licence` (the new migration
`0165`, following the same process as every earlier `ui_strings`
migration this project has shipped). No `vf-app` schema migration —
this decision reuses existing tables end to end.

**Then, in AP Setup → Stage Restrictions, uncheck all three Account
Coding fields for the Validation stage.** That is the actual fix for
what was reported — nothing in this decision changes the live tenant's
data on its own, since this session has no database access. Once
unchecked, a Validation-stage user (in particular, an outsourced
data-entry team) will no longer see or be able to key Project,
Commodity Code, or General Ledger Code on an invoice line; Coding-stage
users are unaffected, since the customer-level default (set on the
Account Coding tab) is untouched.
