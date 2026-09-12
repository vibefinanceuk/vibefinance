# 0266 — A rule's own name

**Status: built.** Independent of the activity panel this enabled —
that stays a mock-up until it's built for real.

---

## Why

Decisions 0264/0265 sketched an activity panel that wants to say
*"Business rule 'Spend Threshold' fired: routed to AP Review and
assigned to the AP Team."* There was nowhere to put "Spend Threshold."
A rule has `source_text` — the full sentence someone wrote — and
nothing shorter that survives being read back.

## Where a name lives, and where it deliberately does not

**On `rules`, not `rule_versions`.** A name is the rule's own identity.
"Spend Threshold" does not change because somebody edited the sentence
and compiled a v2 — putting it on the version would mean either
recompiling to rename, or the name quietly reverting to null on the
next edit. Migration `0058` adds one nullable column, no backfill,
decision 0071's own precedent: nothing is invented for a rule compiled
before this existed.

**Renaming is not part of compiling.** `compile-route.ts` accepts a
name only when creating a brand-new rule; a recompile of an existing
rule ignores it outright, whether or not a caller happens to send one.
A dedicated `handleRenameRule` — one column, one query, no model call,
no new draft version, no re-approval — is what changes a name
afterward. Folding renaming into the compile route would have meant a
routine version bump could silently rename or blank a rule nobody
meant to touch, and would have meant fixing a typo in a label costing
a real model call and a fresh worked-examples generation it never
needed.

## Where it surfaces

- **`compose.js`** — a name field beside the sentence, present only
  when writing a new rule. Absent while revising: an input with no
  effect (the route ignores it on recompile) would promise something
  it cannot do, the same argument decision 0142 made for a Save button
  on a read-only form.
- **`rule.js`** — the name, or an invitation to give it one, with a
  rename control using the same `window.prompt` pattern `sources.js`
  already established rather than a second way to do the same kind of
  thing.
- **`rules.js`** — a named rule shows its name as the headline, with
  the sentence kept underneath in muted text rather than replaced; an
  unnamed rule is unchanged.

## What was found building it

- `applyTestSchema()` (vf-app's shared test setup) does not
  auto-discover new migrations — each has to be added to its explicit
  list by hand. Missed on the first pass; caught when 15 existing
  tests failed with "table rules has no column named name," not just
  the new ones.
- The rename route needed adding to `vf-ui`'s own proxy allow-list
  separately from `vf-app`'s route — the same two-registration pattern
  every mutating route in this app has needed since that list was
  built.

Every new behaviour probed directly: recompile touching the name,
rename having a side effect beyond the name, and the list's name
display, each confirmed to fail correctly when broken on purpose.

vf-app: 1476 tests. vf-ui: 49 Worker, 300 browser. vf-licence: 320.
