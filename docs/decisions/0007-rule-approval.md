# 0007 — Worked examples and rule activation (Blueprint build order step 3)

Status: settled, 30 August 2026. Implements "Examples as tests: generate
worked invoice examples per compiled rule, confirmed by the author
before activation" — the build-order step that had been open since the
compiler shipped, and the schema (`rule_examples`) had been sitting
ready, unused, since the very first migration.

## Never trust the model's own claim — verify it

The Blueprint's own phrasing is "have it also produce invoices the rule
should and should not fire on." The easy, wrong way to build this is
to ask the model for examples and store whatever it says. Instead,
`shared/compiler/examples.ts` re-evaluates every generated example
against the real interpreter (`evaluateConditions`, a small new export
from `shared/interpreter/evaluate.ts` that reuses the exact evaluation
logic `evaluateRuleSet` already uses in production — not a parallel
reimplementation that could silently drift) and refuses the whole
batch if even one example's claimed outcome doesn't match what the
interpreter actually computes.

This mirrors the main compiler's own refusal discipline exactly:
"refusal as a first-class output" isn't only about the rule's
vocabulary — it applies just as much to the worked examples meant to
demonstrate that rule is correct. An unverified example that happened
to be wrong would be worse than no example at all, since it would give
the author false confidence.

## Two model calls, not one, and why that's the right shape

Generating examples is a separate `CompilerModel` call from compiling
the rule itself (`compile.ts`'s `compileRule`), not a single combined
prompt asking for both. This keeps the compiler's own prompt, parsing,
and refusal boundary entirely untouched — a change to how examples are
generated can never accidentally affect how rules are compiled, and
vice versa. The cost is a second network round trip; given
example-generation failure must never undo a successfully compiled
rule (see below), keeping them as genuinely separate steps was worth
that cost.

## A failed example generation does not undo the rule

If `generateExamples` refuses (unparseable response, inconsistent
claims, missing coverage of one direction), the rule itself — already
validly compiled and stored in `rule_versions` — is not rolled back.
The response reports `examples: { status: "refused", reason }`
alongside the successful compile, and the rule sits as a stored draft
with zero examples. Since `activate-route.ts` requires at least one
example to exist, this rule simply cannot be activated until examples
exist for it — a real, honest dead end today (no retry endpoint yet),
not a silent one: the `examples.status` field in the compile response
makes the gap visible immediately rather than requiring someone to
discover it later by trying to activate.

## Activation is the actual enforcement point

`POST /rules/:ruleId/versions/:version/activate` is where "A person
activated this. Never auto-promote a generated rule" (the
`rule_versions` schema's own comment, since the very first migration)
becomes an enforced fact rather than a documented intention. Three
things must hold, checked in this order:

1. The rule version exists and hasn't already been activated.
2. At least one worked example exists for it.
3. Every example that exists has been confirmed
   (`rule_examples.confirmed_by` is set).

Deliberately conservative: a rule with 3 examples and 1 unconfirmed
cannot activate, even though 2 are confirmed. "The customer said yes,
this is what I meant" (the schema's own words) has to be true of
*every* example the model produced, not a majority of them.

Confirmed live in this bundle's own tests: the unconfirmed-example
guard, the zero-examples guard, and the already-activated guard were
each deliberately disabled in turn and confirmed to cause a real test
failure — not just asserted to exist in a comment.

## The scope boundary, stated plainly (closed 30 August 2026)

This was the one thing about the original bundle worth being very
clear about, because it would have been easy to read "rule activation"
as "activated rules now run" — at the time, **they didn't**.
`POST /rules/evaluate` took its `ruleSet` directly from the request
body only; it never loaded activated rules from D1 at all.

Closed the same day: `rule-set-loader.ts`'s `loadActiveRuleSet()` now
loads a rule set from D1, filtered to exactly the rules that should
actually govern evaluation — `rules.enabled = 1`, that version's
`approved_by IS NOT NULL` (never reachable without every worked
example having been confirmed first — activate-route.ts's own gate),
and `now` falling within `[effective_from, effective_to)`.
`POST /rules/evaluate` now accepts *either* an inline `ruleSet`
(kept, for testing and reproduction — see below) *or* a `ruleSetId`
that triggers this load, and refuses ambiguity outright: providing
both, or neither, is a 400, never a silent preference between them.

Proven, not just asserted: each filtering condition (approval, enabled,
effective-from, effective-to) was independently disabled in the real
query and confirmed to cause a real test failure — including one real
false positive caught along the way, where the first version of the
"excludes an unapproved rule" test passed even with the approval check
entirely removed, because its `effective_from` was left at its null
default, which was independently excluding the row for an unrelated
reason. Fixed by isolating the test properly before trusting it.

The inline `ruleSet` path is deliberately kept, not removed — it's
what makes "given an exact ruleSet and known facts, the outcome is
fully reproducible" (the Blueprint's own support argument) actually
true without needing D1 access to reconstruct a past decision, and it
remains useful for testing a rule before it's ever activated.

## What's still open

- No retry path for a rule whose example generation failed — the
  operator's only option today is re-running the whole
  `POST /rules/compile` for a new source text, or direct D1 access
  (matching the precedent already set for `rule_sets` provisioning).
- No versioning story yet for a *second* compile of the same rule.
  `compile-route.ts` still hardcodes `version = 1` for every new rule;
  there's no path to compiling a v2 of an existing rule, so activation
  and confirmation only ever apply to a rule's first and only version
  today. `loadActiveRuleSet`'s multi-version selection logic (highest
  qualifying version wins) is written defensively for when this
  changes, but is entirely unexercised by any real data yet.
- `/rules/evaluate` — closed, see above.

## Addendum, found deploying this bundle: `POST /licence/refresh`

The first real attempt to use this feature live hit `{"error":"processing
blocked","reason":"no licence has been provisioned for this instance
yet"}` — not a bug in this bundle, but the same class of problem
already found and fixed for usage telemetry
(`docs/decisions/0004-usage-telemetry.md`): the only thing that
populates `licence_cache` is the 6-hourly `scheduled()` cron, and a
recently (re)configured instance has no way to force that sooner.
Confirmed directly — `SELECT * FROM licence_cache` on the live
`vf-app-poc` returned nothing at all.

Fixed the same way usage telemetry was: `POST /licence/refresh`, an
on-demand equivalent of the cron's licence-fetch block, sharing its
fetcher-construction logic (`createLicenceFetcher`, extracted from
`scheduled()`'s previously-inline closure so both call sites can't
drift apart) rather than a second copy. Deliberately **not**
licence-gated, and for a sharper reason than `/usage/push`'s: gating
this behind `isBlocked()` would make the bootstrap-blocked state (no
cache row at all) permanently unrecoverable via the API — the state
this endpoint exists to fix is exactly the state a gate would use to
block it.

Its fail-open property was proven the same way the underlying
`refreshLicenceCache` function's was originally: a failed on-demand
refresh must report the *prior* cached state, not a cleared one —
deliberately broken and confirmed to cause a real test failure before
being trusted.
