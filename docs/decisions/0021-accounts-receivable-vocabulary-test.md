# 0021 — Accounts Receivable proves the vocabulary-sharing hypothesis

Status: settled, 1 September 2026. Decision 0015 flagged this
explicitly, without resolving it: "AP and AR likely don't need
separate field vocabularies... not confirmed — flagged as worth
checking once real AR rules are actually written." This is that
check. Chosen deliberately as the cheaper of two possible tests —
Expense, the harder case with no EN 16931 grounding at all, remains
unattempted and unresolved.

## The result: it holds, with zero production code changes

Every test in `test/ar-process.test.ts` exercises only infrastructure
that already existed, built and tested exclusively with AP in mind:
`evaluateRuleSet`, the workflow engine (`visitCurrentStage`,
`onTaskCompleted`), `handleCreateTask`, and the closed vocabulary
itself. Nothing was added, changed, or special-cased for AR. A rule
using `direction` (an existing derived field), `older_than_days` (an
existing operator), and `assign_task` (an existing action) — a
combination that had literally never been evaluated together before
this — correctly matched a real overdue receivable invoice, spawned a
real task requiring `AR.Collect` (a permission that has existed in
the closed vocabulary since decision 0009, explicitly noted then as
having "zero backing capability" — this is its first real use
anywhere in this codebase), and the process instance blocked and
later advanced exactly the way an AP instance already does.

## The genuinely load-bearing test: does `direction` actually discriminate

The critical case wasn't "does an AR rule fire" — it was "does an
otherwise-identical, equally overdue **payable** invoice correctly
**not** fire it." Proven directly: the same 90-day-overdue age, the
opposite `direction` value, and the AR collections rule correctly
never matched. Had this failed, it would have meant `direction` isn't
genuinely discriminating invoices by direction at all, and the same
rule set would wrongly fire AR collection actions against AP's own
invoices sharing a database — a serious correctness bug, not a minor
one. It didn't fail.

A fourth test confirms AR and AP processes genuinely coexist in the
same database with no shared state or interference: two independent
process instances, two independent rule sets, evaluated side by side,
each reaching the correct, independent outcome.

## Why this is real evidence, not a tautology

It would have been easy for this test to only prove what was already
known — that the interpreter is a pure function, which was never in
question. What it actually tested is whether anything in the
*surrounding* system (the workflow engine, task creation, permission
validation) had quietly baked in an AP assumption despite the
generic design decisions 0015/0018/0019 already made. None had. This
is meaningfully different from — and more informative than — simply
re-asserting that `evaluateRuleSet` doesn't know what an invoice is;
it confirms every layer built on top of it during this session
inherited that same discipline rather than accidentally narrowing it.

## What this does not test

- **Whether the field vocabulary itself needs to be domain-specific**
  — AR reuses `INVOICE_FIELDS` entirely unchanged, since an AR
  invoice is still an EN 16931 document. This test cannot speak to
  whether a domain with no such document underneath it (Expense,
  decision 0015's own "genuinely hard case") would hold up the same
  way — that remains genuinely open.
- **The real compiler.** Every rule here was seeded directly via D1,
  bypassing `POST /rules/compile` entirely. Whether the AI compiler,
  whose prompt has only ever shown it AP-flavored worked examples,
  can correctly produce this same `direction`/`older_than_days`/
  `assign_task` combination from a natural-language AR sentence is a
  separate, unanswered question — a natural next live test, not
  covered here.
- **A real, authored AR process definition** intended for actual use.
  The process built here (Issued -> Awaiting Payment -> Paid) is
  illustrative, sized to prove the mechanism, not a considered design
  for real AR operations.

## What's still open

- The real compiler test named above.
- Expense — the harder, more revealing test of the same hypothesis,
  explicitly deferred when this test was scoped.
- A genuinely designed AR process, if this product's AR functionality
  (still listed as "Proposed, not built" in the Scaffolding design
  document) is ever actually built out.
