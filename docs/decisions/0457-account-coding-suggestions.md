# 0457 — Account Coding Suggestions, Phase 1: A Frequency-Based Default From the Supplier's Own History

**Status: confirmed pushed, deployed, and migration applied.**
`origin/main` fetched directly reads `2b4c520`, matching this
session's own commit exactly, and the operator confirmed `wrangler
deploy` run for `vf-app` and `vf-ui`, plus migration `0155` applied
via `apply_migrations.py --remote` against `vf-licence-poc`.

---

## What was asked

Raised by the operator alongside decision 0455's own request: *"I would
like to introduce in the future an autocode feature, which defaults
these values based on AI - learning. I'd appreciate your thoughts on
that configuration also."* Design thoughts were given in conversation
— a frequency-based Phase 1 now, a learned-model Phase 2 later, kept
advisory rather than automatic in both — and the operator approved
Phase 1 directly: *"yes please"* to *"Want me to scope Phase 1 — the
frequency-based default — as a real decision?"*

## What was built

**A pure aggregation module, not a rule.** `coding-suggestions.ts`
computes a per-field suggestion for the four Account Coding fields
(`BT-133`, `coding.project`, `coding.commodity_code`,
`coding.gl_code`) by reading `keyed_fields` — the table that already
records every person-keyed value, decisions 0030/0035 — grouped by
`new_value`, scoped to the invoice's own `supplier_vat_id`, and joined
against `invoice_headers` to get it. No new capture mechanism: the
training data already existed, just never aggregated.

Deliberately **not** built as a rule-engine `set_field` action. A rule
is deterministic and human-authored — approved by a person, with
confirmed examples, before it can fire (`activate-route.ts`'s own
gate). A frequency default is neither: it changes as more invoices get
keyed, and it is a suggestion to review, not a fact to assert. Keeping
it as its own module also sidesteps the limitation decision-time
research already found in this session — `set_field` outcomes don't
persist at line-evaluation scope (`workflow-engine.ts`'s own
`evaluation.lineNumber === null` gate) — since this isn't evaluated as
a rule at all.

**Thresholds, so a thin history doesn't suggest with false
confidence:**
- `MIN_SAMPLE_SIZE = 3` — fewer than three prior keyed values for this
  supplier and field, and no suggestion is offered at all.
- `MIN_CONFIDENCE = 0.5` — the most frequent value must account for at
  least half of what's been keyed, or nothing is offered. A supplier
  whose invoices get coded to five different cost centres roughly
  evenly should not have Claude — or anything else — pick one for
  them.

**The route.** `GET /invoices/:id/coding-suggestions`, gated the same
as the routes it sits beside — `Admin.Configure`, `AP.Validate`, or
`AP.Code` (decisions 0453/0455/0456's own `requireAnyPermission`
list) — 404s if the invoice doesn't exist, and returns `{suggestions:
{}}` rather than erroring when the invoice has no supplier on file yet
(nothing to scope the aggregation to).

**The pop-out.** `openLineCodingPopout` (decision 0453) now fetches
suggestions before rendering. For each of the four fields: an existing
value on the line always wins outright — a suggestion never overwrites
what's already there, keyed by a person or otherwise. A field with no
existing value and a qualifying suggestion is pre-filled with the
suggested value immediately (so it's already on the line, the same as
anything else `line[spec.field]` holds, and `Save` — which reads that
value from wherever it came from — persists it with no extra click),
and shown with a visible note: *"Suggested from this supplier's own
history — review before saving."* The moment a person makes any real
choice for that field — including re-choosing the exact same value —
the note disappears and the field is treated as a normal keyed value
from then on.

## What was not built

- **No confirmed-vs-left-as-suggested distinction in `keyed_fields`
  itself.** A pre-filled suggestion that the person never touches gets
  saved exactly like a value they typed — `keyed_fields` has no way to
  tell "this person looked at this and agreed" apart from "this person
  never looked at this row at all." That's a real gap for anyone later
  wanting to know how much of the coding on file was actually reviewed
  versus quietly accepted by inaction. Not fixed here because closing
  it means either a new column on `keyed_fields` or a parallel
  provenance table, and this decision's own scope was the suggestion
  itself, not a review-tracking system — worth raising back to the
  operator if it matters before this goes live broadly.
- **No explicit "Accept" step.** The alternative design — never
  auto-write the suggestion, require a person to click something
  before it counts — was considered and rejected for Phase 1 as
  needless friction against the feature's own point (a person who
  agrees with the default shouldn't have to act twice), but it's the
  natural next lever if the gap above turns out to matter.
- **No Phase 2 (a real learned model).** Explicitly out of scope for
  this decision, per the conversation that led to it — this is the
  frequency-based Phase 1 only.
- **No equivalent for Matching.** Only Account Coding's own four
  fields are covered; nothing here touches the Matching stage.

## Verification

`workers/vf-app`: new `test/coding-suggestions.test.ts` — **9/9**,
covering no history, below `MIN_SAMPLE_SIZE`, a clear majority
suggestion, a too-split history correctly offering nothing, per-
supplier isolation (one supplier's history never leaks into another's
suggestion), independence between fields, a 404 for a nonexistent
invoice, and an empty `{suggestions: {}}` for an invoice with no
supplier on file. `test/index.test.ts` — 3 new tests through the real
router (401 with no credentials, 403 with neither qualifying
permission, and a full end-to-end pass seeding three invoices for one
supplier with `keyed_fields` history and asserting the route returns
the right value, confidence, and sample size). Both seed
`keyed_fields`/`invoice_headers` directly via `env.DB.prepare(...)`
rather than driving the full `POST /invoices/:id/key` route, which
requires a `facts` body and an in-progress process instance at an
editable stage — correctly out of scope for tests aimed at the
aggregation and routing logic, not the keying flow itself. Full
whole-repo `vf-app` suite run unfiltered afterward — **2733/2733
passing across 114 files**, zero regressions.

`workers/vf-licence`: new migration `0155_coding_suggestion_string.sql`
(one key, `viewer.coding.suggested`, en/de) — `apply_migrations.py
--replay-only` clean, **155 migrations, all assertions held**.
`test/string-coverage.test.ts` initially failed after the migration
was written — not because the key was wrong, but because
`test/setup.ts` hand-imports and applies each migration file
individually and had never been wired up past `0154`, a gap this
decision found and fixed by adding the missing import and exec call.
Full whole-repo `vf-licence` suite run unfiltered afterward — **320/320
passing across 21 files**.

`workers/vf-ui`: `viewer.js`'s `openLineCodingPopout` rewritten async
around the new `fetchCodingSuggestions()`. The pre-existing decision-
0453 "invoice-line Coding pop-out" describe block (8 tests) re-run
first, confirmed still green with no changes needed beyond stubbing
the new route and adding the new string to the test's own
`CODING_STRINGS` map. Four new tests added alongside them: a field
with no existing value pre-filled from a suggestion with the note
visible; `Save` persisting a pre-filled suggestion with no explicit
click; choosing any value — including the same one — clearing the
note; and a field that already has a value on the line never
overwritten or flagged by a suggestion. Full whole-repo browser suite
run unfiltered afterward — **1060/1060 passing across 48 files** (1048
+ 12 new: 4 here plus, per the file's own comment, the room already
counted for `document-window.test.ts`'s pre-existing unhandled-
rejection flake, confirmed present at its identical baseline count of
160 non-fatal errors and reconfirmed via `git stash` as unrelated to
this decision — none of them a failing assertion).

`npx tsc --noEmit`: zero errors in `coding-suggestions.ts` or the
`index.ts` route wiring; the two new test files each surface the same
pre-existing, repo-wide `Cannot find module 'cloudflare:test'`
cross-project resolution gap that affects every test file in this
monorepo, unrelated to this decision and unchanged by it.

## Still to do, operator side

All done — `wrangler deploy` confirmed for both `vf-app` and `vf-ui`,
and migration `0155` confirmed applied to `vf-licence-poc` via
`apply_migrations.py --remote`, all in the operator's own single
report: *"pushed and deployed."*

Worth watching once live: whether `MIN_SAMPLE_SIZE`/`MIN_CONFIDENCE`
feel right in practice, and whether the "no confirmed-vs-suggested
distinction" gap named above turns out to matter for anyone auditing
what was actually reviewed.
