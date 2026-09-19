# 0409 — One firing, not one per line

**Status: built.**

---

## What was asked

Discussing whether triggered rules should log to the Timeline/Chat
audit trail — they already do, since decision 0267 — the follow-up
question was whether that would get long. It already mostly doesn't:
an automatic stage (no rule set) writes nothing, and only a rule that
actually matched shows up at all, never one merely evaluated.

**One real gap, found by reading the code rather than guessing:** a
rule set scoped to evaluate per line (decision 0027) runs once per
invoice line, and each line's own trace becomes its own
`stage_visit_steps` row. `ruleFiredEvents()` had no `GROUP BY` and
never even selected `line_number` back out — so a rule matching on
eight of twelve lines produced **eight identical, same-timestamp
entries**, indistinguishable from one another: *"Business rule 'Line
Threshold' fired: flagged it"* × 8, with no way to tell which lines
any of them were about.

---

## What was built

### `workers/vf-app/src/activity-route.ts`

`ruleFiredEvents()`'s query now also selects `stage_visit_steps.rule_id`,
`.rule_version`, `.line_number`, and `stage_visits.id` (needed to
group correctly — the same rule can genuinely fire again at a later,
separate visit, and that must stay two entries, not collapse into
one). Rows are grouped in application code by `(visit_id, rule_id,
rule_version)` — one firing, however many lines it matched — with
every matched `line_number` collected, sorted, and carried on the
returned `ActivityItem` as `lines: number[]` (empty for an ordinary
header-scoped firing, which only ever evaluates once). Nothing about
`describeAction()` or the batched name lookups changed; they still run
once per group, not once per line.

### `workers/vf-ui/public/activity.js`

`ruleFiredLine()` appends a plain-text suffix built from `item.lines`
— `" (line 4)"` for one, `" (lines 2, 5, 7)"` for several, nothing at
all when the array is empty. **Deliberately not run through `t()`.**
`activity.rulefired`'s own sentence frame is localized (decision
0078's migration), but the action descriptions it wraps
(`describeAction()`, server-side) never have been — this sits in that
same already-accepted gap rather than opening a new, inconsistent one
for just this one piece. A real localization pass, if wanted, is one
piece of work across both, not two separate ones.

---

## Tests

`workers/vf-app/test/activity-route.test.ts` — `fireRule()`'s helper
gained an optional `lineNumber`, and its `INSERT` now carries
`line_number` (previously omitted, always implicitly `NULL`). Two new
tests: a rule matched on three separate lines within one visit
collapses to one `rule_fired` entry with `lines: [2, 5, 7]` (sorted,
not insertion order); an ordinary header-scoped firing carries
`lines: []`. Fail-first verified — both failed correctly against the
unfixed query (`toHaveLength(1)` got `3`; `.lines` was `undefined`)
before the fix, passed after. Full suite: **1952/1952** (1950 + 2
new).

`workers/vf-ui/test-browser/viewer.test.ts` — three new tests: the
multi-line suffix renders, the singular "line" wording for exactly
one, and an ordinary firing renders with no `"(line"` text at all.
Fail-first verified by stashing `activity.js` alone — the first two
failed on the unsuffixed sentence; the third passed regardless, as it
should, since it doesn't depend on the fix. Restored, all three pass.
Full `vf-ui` suite: 74/74 Worker, **715/715** browser (712 + 3 new) —
the same pre-existing 162-error batch of unhandled promise rejections
in `document-window.test.ts` (unrelated, confirmed identical with and
without this change in decision 0408's own investigation) is present
unchanged.

`eslint` clean on every changed file. `scripts/check-citations.py`
clean once this record exists.

---

## What is not built

**No cap on how many lines get listed.** A rule matching on, say, forty
of an invoice's lines would list all forty rather than summarising —
deliberately: this codebase's own precedent (`set_field`'s field code
in `describeAction()`, decision 0267's own words: *"the code is
accurate; a nicer label is a real follow-up, not something to
approximate now"*) favours an honest, exact answer over a guessed-at
threshold nobody asked for. A real cap, if forty-line rule firings
turn out to be common enough to be worth it, is a follow-up with real
usage data behind it, not a number picked here.

**No localization of the lines suffix**, matching the pre-existing gap
in `describeAction()` this sits alongside rather than closes.
