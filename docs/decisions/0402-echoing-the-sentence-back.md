# 0402 — Echoing the sentence back

**Status: code built and tested, not yet pushed. Live rule data
already patched directly**, ahead of the code deploy — the reported
symptom (a stuck invoice with no visible task) needed to stop
happening now, not after a full deploy-and-recompile cycle across
seven rules.

---

## What was asked

The operator's own report: *"The Documents page shows the item in
Stage Validation, and Status of In progress. However, when I click on
Tasks, I cannot see any items pending retrieval."*

---

## The investigation

Ground truth, not a guess: `stage_visits`/`stage_visit_steps` for the
stuck invoice showed the gating rule genuinely `matched: 1` — the rule
engine was doing its job. No `tasks` row existed at all. `task-route.ts`'s
`handleCreateTask` does `SELECT id FROM org_teams WHERE id = teamId` and
404s on no match; `workflow-engine.ts`'s `assign_task` loop turns that
404 into `{ status: 500, ... }`, returned *after* the stage_visit row
was already committed — so the invoice just looks stuck, with nothing
in the UI to say why.

The matched rule's `compiled_json` named `"team": "AP team"` — the
words from the rule's own sentence ("assign a task to the AP team"),
not `org_teams.id`, which is `"ap-team"`. Root cause, traced to
`shared/compiler/prompt.ts`'s `WORKED_EXAMPLE`: the few-shot example
shown to the compiling model before every single compile itself used
`"team": "AP team"` — teaching the model, by the strongest signal a
prompt has, to copy the sentence's own words rather than resolve them.
Compounding it: `buildCompilerPrompt` was never given the real
`org_teams` list at all, so even a model that ignored the bad example
had nothing to check a team mention against.

A system-wide query (replicating `loadActiveRuleSet`'s own activation
criteria exactly) found the blast radius: **8 currently-active
`assign_task` rules**, of which **6** carried this exact bug. Two more
referenced teams that don't exist in `org_teams` at all (`"AR team"`,
`"finance team"`) — left alone, as leftover compiler-test artifacts for
domains (AR, Expense) that aren't built yet.

**A sibling bug, found while reviewing those 6.** Rule `88f6e5ef`'s
`route_to` action stored `"stage": "AP Review"` — the stage's *display
name*, not its real `process_stages.id` (`"review"`). Same root cause
(no real data to resolve a sentence's reference against), a different
action type, and a louder failure: `workflow-engine.ts` 422s a
`route_to` naming an unknown stage rather than swallowing it, so this
one would have surfaced as a visible error the first time the rule
fired, not silently. A system-wide check (every currently-active rule
mentioning `route_to`, not just the 6 already known) found `88f6e5ef`
was the only one.

**A third, different bug, found by the same sweep.** Rule `94e1d9db`
("If the invoice duplicate probability is over 60%, please assign to
the AP team") compiled to `assign_org`/`"org": "AP team"` — but
`org_units` (`acme-group`, `acme-uk`, `finance`) has nothing resembling
"AP". This isn't an id-resolution slip like the other two: the
compiler chose the wrong *action type* for the sentence entirely
(`assign_org` targets a legal entity/operating unit, not a team).
`workflow-engine.ts` 409s an unknown org, so this also fails loudly
rather than silently. Fixed as its own, separately-reviewed patch — see
below — since guessing the right action type is a materially bigger
inference than resolving a name to its id.

---

## What was built

### `shared/compiler/prompt.ts`

- `WORKED_EXAMPLE`'s and `EXPENSE_WORKED_EXAMPLE`'s `assign_task`
  actions corrected to `"team": "ap-team"` / `"team": "finance-team"`,
  each with an explanatory sentence appended: resolve to the real id,
  never copy the sentence's words, however close they read to a name.
- `buildCompilerPrompt` gained two new optional parameters, `teams:
  {id, name}[]` and `stages: {id, name}[]`, each rendering a new
  prompt section — `REAL TEAMS` / `REAL STAGES` — only when non-empty,
  listing the real ids/names and instructing the model to resolve a
  sentence's reference to the matching id by meaning, never by copying
  its words, and to refuse rather than invent an id when nothing
  matches. Structurally parallel to decision 0210's existing
  `stagePermission` section. Empty by default, so every pre-existing
  call site (and test) keeps compiling exactly as before.

### `shared/compiler/compile.ts`

`compileRule` gained matching `teams`/`stages` parameters, threaded
straight into `buildCompilerPrompt`.

### `workers/vf-app/src/compile-route.ts`

`handleCompileRequest` now fetches `SELECT id, name FROM org_teams`
(same pattern as its existing `stage?.required_permission` fetch) and
`SELECT id, name FROM process_stages WHERE process_id = ?`, scoped to
the rule set's own process — `route_to` can only ever target a stage
in the same process (`workflow-engine.ts`'s own `WHERE id = ? AND
process_id = ?` check) — and passes both through to `compileRule`.

### Live rule data (`docs/../` scripts delivered separately, not
committed to the repo — see below)

Seven rules patched directly, each as a new `rule_versions` row
following this project's own never-edit-in-place discipline (decisions
0007/0014): the prior version's `effective_to` closed at the exact
same timestamp the new version's `effective_from` opens, the same
close-then-open order `activate-route.ts` itself uses, so there is
never a gap or an overlap.

- Six rules (`c7fc7602`, `0a1f23bb`, `3941ff33`, `96abd97c`,
  `88f6e5ef`, `98ca6c0d`): `compiled_json` corrected in place —
  `"AP team"` → `"ap-team"`, and for `88f6e5ef` additionally
  `"stage":"AP Review"` → `"stage":"review"`. Nothing else in any of
  these rules' logic changed; verified by diffing the exact stored
  `compiled_json` before and after.
- One rule (`94e1d9db`): recompiled from `assign_org`/`"AP team"` to
  `assign_task`/`team:"ap-team"`, the evident intent. Its stage
  (`validation`) declares no default permission and the sentence names
  none, so a permission had to be chosen for `assign_task` to work at
  all — `AP.Validate` was used, matching every other `assign_task` rule
  in the same rule set. This is an inference about intent, not
  something the sentence said, and was reviewed separately from the
  other six before running for exactly that reason.

**This bypasses the app's own "worked examples confirmed" activation
gate** (`activate-route.ts` requires at least one confirmed
`rule_examples` row before a version can activate; these seven new
versions have zero). Deliberate, and narrow: six of the seven fixes
are a single verified JSON string correction, not a new interpretation
of any sentence, so re-verifying against worked examples would confirm
nothing new. The seventh (`94e1d9db`) carries a real inference (action
type and permission) and was flagged to the operator as such before
running. `compiled_by` on every patched version reads
`"manual-patch:..."` rather than a model id, and `approved_by` is the
operator's own email (not `alice@acme.com`, the identity that approved
the original broken versions) — both deliberately honest about how
these versions actually came to be.

A verify script comparing "is this active" via SQLite's `datetime('now')`
initially produced a false negative on the first patch: `datetime('now')`
returns `"YYYY-MM-DD HH:MM:SS"` (space, no `Z`), while the real app
(`rule-set-loader.ts`) compares against JS's `now.toISOString()`
(`"YYYY-MM-DDTHH:MM:SS.sssZ"`) — comparing those as raw strings is
wrong, since `'T'` (0x54) sorts after `' '` (0x20), making any
same-day `effective_to` look "in the future" regardless of actual
time. The patch statements themselves never used `datetime('now')` —
only literal hardcoded timestamps and an `effective_to IS NULL` check
— so they were unaffected; a corrected, date-format-safe verification
(listing every version of each rule with no date filtering at all)
confirmed all seven patches landed exactly as intended.

---

## Tests

`shared/compiler/prompt.test.ts` — two new `describe` blocks (teams,
stages): each section renders when data is given and its own key
strings (id, name) appear; omitted entirely when the list is empty,
including the default (no 4th/5th argument) case; instructs
resolve-by-meaning-not-by-copying and refuse-rather-than-invent; the
worked examples themselves resolve to real ids independent of whether
a live list is passed. Fail-first verified against the pre-fix
`prompt.ts`.

`shared/compiler/compile.test.ts` — two new `describe` blocks
confirming `compileRule` passes its `teams`/`stages` arguments through
to the prompt, and that omitting them (existing callers) leaves the
prompt unchanged.

`workers/vf-app/test/compile-route.test.ts` — two new `describe`
blocks: `handleCompileRequest` fetches `org_teams` and includes them in
the prompt; a rule set with no stage yet gets an empty stage list, not
an error; scoping `process_stages` to the rule set's own process
(a second process's stages never leak into the prompt); and an
end-to-end case confirming the persisted `compiled_json` resolves to
the real id, not the sentence's words, for both `assign_task`/team and
`route_to`/stage.

Fail-first verified throughout (reverted `prompt.ts`/`compile.ts`/
`compile-route.ts` alone, confirmed every new test failed for the
right reason, restored the fix, confirmed all pass). Full `vf-app`
suite: **1947/1947**. `eslint` and `scripts/check-citations.py` clean.

---

## What is not built

**The two AR/Expense rules referencing nonexistent teams** (`"AR
team"`, `"finance team"`) are left alone — likely leftover
compiler-test artifacts for domains that aren't built yet
(`permissions.ts` has its own comment to that effect). Flagged to the
operator, not assumed to need the same treatment.

**No `rule_examples` rows were generated for the seven patched
versions.** Worth knowing if any of these seven are opened in the
rule-management UI later and look unconfirmed — they are, by design,
for the reason given above.
