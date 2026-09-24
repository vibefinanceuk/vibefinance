# 0474 — Standard matching rules: enable/disable checkboxes on AP Setup's Matching tab

**Status: built and verified locally, not yet committed/pushed at the
time of writing.** No push access from this session — delivered as a
git bundle, per this repo's own established handover mechanism.

---

## What was asked

*"number 1 please"* — the first item of the backlog presented after
decision 0473 shipped: standard-rule checkboxes. Two questions genuinely
needed the operator's own answer before any code was written, since
either one would reshape the whole build:

- **Where should the checkboxes live?** → *"On AP Setup's Matching
  tab."*
- **When a checkbox is checked, should it go all the way to an active
  rule automatically, or stop at a draft for review?** → a free-form
  answer, not either of the two offered: *"Check box only used for
  activating / deactivating existing compiled rules."*

That second answer is the governing, narrowing decision for this whole
feature. It settles a real design fork the design doc's own phrasing
("runs the existing compile-and-activate pipeline... exactly as if the
operator had... pressed activate") left ambiguous: reading that phrase
literally would have meant either violating this codebase's own
repeated "never auto-promote a generated rule" principle (decisions
0001, 0014, 0031, 0034, 0155, 0266 — every one of them insists a person
activates a rule) by auto-confirming AI-generated examples, or silently
narrowing the scope on this session's own judgment. Asked directly
instead. The answer is narrower than either original option: **the
checkbox never compiles or creates a rule.** It only flips `enabled` on
a rule that must already exist. Creating one of the four standard rules
for the first time is unchanged, ordinary rule authoring on whichever
stage's own Rules screen the operator picks — write the suggested
sentence, compile, confirm every generated example, activate.

## What was found

- **`PUT /rules/:ruleId/enabled`** (`rules-list-route.ts`,
  `handleSetRuleEnabled`, decision 0155) already does exactly the write
  operation these checkboxes need. "Pausing is not unapproving" — it
  flips only the `enabled` column, leaves approval state untouched, and
  is already gated `Admin.Configure`. **No new write route was
  needed.**
- **There is no canonical "Matching" stage anywhere in this system.**
  Stages are entirely customer-configured through Processes
  (`process_stages.rule_set_id`); an org could have zero, one, or
  several stages that reference matching facts. Decision 0355 already
  fixed the exact failure mode a naive lookup would repeat here —
  `handleListRules` silently returning "every rule in the database"
  when no real stage was given (*"When I highlight the AP Line Review
  Process, which has no stages - I see many rules."*). The lookup this
  decision needed had to stay bounded without a stage to scope to.
- **Decision 0465's own governing principle, quoted directly in the new
  code**: *"There is no existing concept of a 'system' rule distinct
  from a customer-authored one, and building one would cut against
  decision 0031's own governing principle... ship a small set of
  pre-written sentences... offered as one-click checkboxes... No new
  rule mechanism, no parallel path around the compiler."* This settles
  the identification question the same way: a standard rule is
  identified **by its exact `rules.name`**, not a new database column
  or table. Four canonical names, a closed list.
- **`stateOf`** (`rules-list-route.ts`, decision 0149) already
  classifies any rule row into `"live" | "paused" |
  "awaiting_confirmation" | "draft"` from `approved_at`/`enabled`/
  `examples_total`. Exported with a narrowed structural parameter type
  rather than reimplemented, so this feature's own differently-shaped
  query result can reuse the same four-way classification without a
  second copy of the same four `if` branches.

## What was built

**Backend — `workers/vf-app`:**

- `rules-list-route.ts`: `stateOf` changed from private to exported,
  its parameter narrowed to `{ approved_at: string | null; enabled:
  number; examples_total: number }` so a second, differently-shaped
  caller can reuse it.
- `matching-config-route.ts`: `STANDARD_MATCHING_RULES`, a closed array
  of four entries (`po_line_not_found` / `price_mismatch` /
  `quantity_mismatch` / `unit_mismatch`), each carrying its exact
  `rules.name`, the `po.line_*` fact it reads (decisions 0464/0466/
  0469), and a ready-to-paste `suggestedSentence` in this codebase's
  own established phrasing convention. `handleGetStandardMatchingRules`
  queries `rules` joined to `rule_sets`, `process_stages`, `processes`,
  and the latest `rule_versions`, filtered to exactly those four names
  — never a broader "every rule" fallback, the same discipline decision
  0355 already established. Groups matches by name; a name authored on
  more than one stage returns every match as its own row, never one
  silently picked over another.
- `index.ts`: new route `GET /matching-config/standard-rules`, gated
  `Admin.Configure` like every other route on this screen.

**Frontend — `workers/vf-ui`:**

- `public/ap-setup.js`: `load()` gained a fourth required fetch,
  `/api/matching-config/standard-rules`, ok-checked together with the
  other three exactly as before (a failure in any one fails the whole
  screen — unchanged discipline). New `standardMatchingRulesPanel`
  function, rendered below the existing tolerance form on the Matching
  tab: each of the four standard rules shows either "not yet created"
  with its suggested sentence, or one row per match. Only `live`/
  `paused` matches carry an interactive checkbox — `draft`/
  `awaiting_confirmation` show disabled with an explanatory note, since
  toggling `enabled` on a rule that has never been activated would
  change nothing `stateOf` can see. The checkbox's own `onchange`
  calls the existing `PUT /rules/:id/enabled` directly; a failed save
  reverts the checkbox and shows the real error, the same pattern this
  file's other forms already use.
- `workers/licence/migrations/0161_standard_matching_rules_strings.sql`
  (new): six keys × en/de for the panel's own copy, wired into
  `test/setup.ts` and `test/string-coverage.test.ts`.
- `workers/vf-ui/src/index.ts`: `PROXIED_TO_INSTANCE` gained
  `/^\/matching-config\/standard-rules$/` — added **alongside** the
  route itself this time, not after a live "could not be loaded"
  report the way decision 0473 had to fix it. `workers/vf-ui/test/
  index.test.ts`'s `CALLED_BY_A_SCREEN` gained the matching entry, in
  the same commit.

**Nothing here touches `/rules/compile`, `/rules/examples/:id/confirm`,
or `/rules/:ruleId/versions/:version/activate`.** No AI model call is
reachable from this feature at all — settled directly by the
operator's own answer, not inferred.

## What was not built

- **No canonical-stage auto-provisioning.** Creating a standard rule
  for the first time is still ordinary rule authoring on whichever
  stage's own Rules screen the operator picks; this feature only reads
  and toggles what already exists there.
- **No bulk "enable all four" action.** Each match is its own
  checkbox, matching the operator's own "activating/deactivating"
  framing at the level of one rule at a time.
- **No compile-time validation that a rule named e.g. "Standard rule:
  Price mismatch" actually implements `po.line_price_matched`.** The
  match is by name only, same as decision 0465 already accepted for
  the sentence suggestions themselves — an operator could rename or
  repurpose a rule with one of these four names and this panel would
  still show it. Not treated as a gap worth a new mechanism for, per
  decision 0465's own governing principle quoted above.

## Tests

`workers/vf-app/test/matching-config-route.test.ts` — 6 new tests
(empty state; a single live match; the four-way state distinction;
more than one match across stages shown separately; an unrelated name
ignored entirely; every entry carries a non-empty suggested sentence
and a `po.line_*` fact) — **15/15** for the whole file.
`rules-list.test.ts` + `index.test.ts` (vf-app) — **202/202** combined,
confirming the `stateOf` export change broke nothing.

`workers/vf-licence` — full suite, **320/320**, including migration
0161's own `string-coverage.test.ts` entries.

`workers/vf-ui` — the specific lesson decision 0473 wrote down was
followed this time: the allowlist entry and its `CALLED_BY_A_SCREEN`
test landed together, and the full package `npm test` script ran
before calling this done, not just the browser config.
`vitest run --config vitest.config.ts` (both files): **74/74**.
`vitest run --config vitest.browser.config.ts`: **1076/1077** — the
one failure (`document-window.test.ts`, an unrelated `/api/documents/
:id/collaborators` stub gap) confirmed pre-existing on a clean
`origin/main` tree via `git stash` before this decision's changes were
even applied, nothing to do with this feature. `ap-setup.test.ts`
itself: **34/34** (28 existing + 6 new, covering not-yet-created,
live→paused toggle with the real PUT body asserted, paused→live
toggle, draft/awaiting_confirmation shown disabled, more than one match
shown as separate rows, and a failed save reverting the checkbox).
`coding-lists.test.ts`: **32/32**, its own separate `openApSetupAs`
helper and all five inline `vi.stubGlobal("fetch", ...)` blocks given
the same new stub — the exact fix category decision 0472 already
needed once for `/api/matching-config` itself, applied proactively
this time rather than after a report.

`tsc --noEmit` and `eslint` both confirmed clean on every touched file
in `vf-app` and `vf-ui` (the only lint/type noise present is pre-existing
and unrelated — a stray `workload.test.ts` cast and cross-package
`cloudflare:test` module-resolution noise neither of which this
decision's files trigger, and one pre-existing unused-variable lint
finding in `ap-setup.test.ts` at a line this decision did not touch,
confirmed present at `HEAD` before this decision's changes).

## Still to do, operator side

Nothing. This feature needs no migration to run beyond 0161 (already
included in this delivery) and no configuration — the four rows simply
show "not yet created" until an operator authors a rule with one of the
four canonical names on some stage's own Rules screen, the same as
today.
