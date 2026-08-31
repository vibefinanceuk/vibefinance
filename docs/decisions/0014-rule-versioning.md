# 0014 — Rule versioning

Status: settled, 31 August 2026. Closes a gap `rule-set-loader.ts`'s
own comment had already anticipated: "written defensively for when
versioning exists... unexercised by any real data yet." Also closes
the retry gap for a rule whose worked-examples generation failed —
recompiling under a new version is now that retry path, where
previously the only option was starting over under a brand new rule
id.

## No schema migration for new data — one for a new invariant

`rule_versions` already had every column a second, third, ... version
of an existing rule needs (`version`, `effective_from`, `effective_to`,
`approved_by`, `approved_at`) — `PRIMARY KEY (rule_id, version)` was
already sufficient to hold multiple versions of the same rule side by
side. This is purely an application-logic feature on top of an
already-correct schema.

One migration was still added:
`0005_rule_versioning_invariant.sql`, a partial unique index ensuring
at most one version of a given rule can have `approved_by IS NOT NULL
AND effective_to IS NULL` at a time — the one currently, actually in
force. Same defense-in-depth discipline as everywhere else in this
project: application logic enforces this (see below), and the index
makes it structurally impossible for that logic to have a bug that
goes unnoticed.

## The model: a clean handoff, full history preserved

Activating a new version closes the previously-open version's
`effective_to` at the exact moment the new version's `effective_from`
begins — no gap (a moment with no version in force), no overlap (two
versions simultaneously eligible). The old version's row is never
altered beyond that one column: who approved it, when, and the window
it was genuinely in force stay intact and directly queryable. This
matters concretely, not just architecturally — `loadActiveRuleSet`
querying at a past point in time correctly returns the version that
was actually in force then, not today's, which is exactly the
Blueprint's own reproducibility argument extended across a rule's
whole history, not just a single version of it.

## `POST /rules/compile` — an optional `ruleId`

Omitted: unchanged, exactly the original behaviour — a brand new rule,
version 1. Provided: the rule must already exist and belong to the
same rule set as the request (refused with a 404 otherwise — silently
moving a rule to a different rule set was never on the table). The
next version is `MAX(existing versions) + 1`, not a count — confirmed
directly with a real v3 compiled after v1 and v2, not just asserted.
Every other property of compilation is unchanged: a refusal still
means nothing is stored, and a refused recompile specifically leaves
the existing rule and all its prior versions completely untouched,
confirmed by a dedicated test.

Worked examples generated for a new version are tied to that version
alone — a rule's v1 examples and v2 examples are never mixed, and
recompiling never touches or deletes a prior version's own examples.

## Two real bugs, found by the safety net actually doing its job

**Statement ordering inside the activation batch.** The first version
of `activate-route.ts` ran the new version's own activation UPDATE
before the previous version's closing UPDATE, inside the same
`db.batch()`. This looked reasonable and every test passed — until the
new partial unique index was actually wired into the test schema (see
below) and a real three-version scenario (activating v3) failed with a
genuine `UNIQUE constraint failed` error. The reason: SQLite checks a
`UNIQUE` constraint immediately per statement within a batch, not
deferred until the whole batch commits. Activating v3 before closing
v2 meant that, for one statement's duration, both v2 and v3 matched
"approved and still open" simultaneously — exactly what the index
exists to forbid. Fixed by reversing the order: close the old version
first, then open the new one, so at no point during the batch does
more than one version match. The fix is now documented directly in
`activate-route.ts`'s own comment, including why the order matters.

**The new migration was never added to the test schema.** All 212
tests initially passed — including the ones specifically testing this
feature — because `workers/vf-app/test/setup.ts` had never been
updated to apply `0005_rule_versioning_invariant.sql`, so the real
database constraint was never actually active during any of those
runs. Caught by checking the test setup file directly rather than
trusting a green test suite alone; fixed, and every test — including
the ordering bug above — was only genuinely proven once the real
constraint was active during the run that caught it.

## `loadActiveRuleSet`'s defensive tiebreak: now further guarded than expected

The multi-version selection logic (`MAX(version)` among qualifying
rows) was written defensively before any real multi-version data
existed. Closing this gap meant writing a test that deliberately tried
to construct "two versions simultaneously open" via a direct `INSERT`,
bypassing all application code — the same way a genuinely anomalous
data state might arise. It's no longer possible: the new partial
unique index refuses it at the database layer, even via a raw insert.
A genuinely good outcome, not a test to force through — the tiebreak
logic remains in `loadActiveRuleSet` as defense-in-depth for a
database that predates this migration or one where the constraint has
somehow been dropped, documented as such directly in that file's own
comment, rather than exercised as a reachable path under the current
schema.

## What's still open

- No way to deactivate or roll back to a previous version once a newer
  one has been activated — the effective-window mechanism supports
  representing this (a future migration could reopen an old version's
  `effective_to`), but no route exists to do it.
- No UI or list endpoint showing a rule's full version history — only
  reachable today via direct D1 queries, matching every other
  precedent in this codebase of "raw API for now."
- Recompiling a rule that was never activated (still on v1, unconfirmed
  or confirmed-but-not-activated) creates v2 exactly the same way as
  recompiling an activated one — the "why recompile something never
  activated" question is left to the operator's own judgment, not
  something this bundle restricts.
