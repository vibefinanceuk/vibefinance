# 0022 — Multi-vocabulary support, and Expense proves the harder hypothesis

Status: settled, 1 September 2026. Decision 0015 flagged the real
prerequisite explicitly, without building it: "each process
definition would declare which field vocabulary its rules compile
against... validateRule(), isKnownField()... currently check against
ONE global, module-level vocabulary. This has to become
parameterized." This is that infrastructure, built, and then used to
run the harder test decision 0021 explicitly deferred — Expense has
no EN 16931 document underneath it at all, decision 0015's own
"genuinely hard case."

## The infrastructure: a real, closed registry, not a special case

`vocabulary.ts` gained `VOCABULARIES` — a closed map from vocabulary
name to its own field list and descriptions. Operators and actions
stay shared across every vocabulary, confirmed correct by decision
0021's own empirical finding, not just assumed; only field lists vary
per domain, which is all this registry holds. `isKnownField`,
`validateRule`, `buildVocabularyDoc`, `buildCompilerPrompt`,
`compileRule`, and `parseModelOutput` all gained an optional
`vocabulary` parameter, defaulting to `"invoice"` everywhere — every
caller written before this change compiles and validates exactly
what it always did, unchanged, unless it explicitly asks for
something else. Proven, not assumed: the full pre-existing test
suite (297 tests before this work started) passed unmodified.

`rule_sets` gained a `vocabulary` column (migration
`0010_rule_sets_vocabulary.sql`), closed to the same set the code-level
registry recognizes, defaulted to `'invoice'` so every rule set that
existed before this migration is correctly, automatically tagged as
what it always was. `compile-route.ts` looks this column up and
threads it through to `compileRule` — the rule set itself, not a new
request parameter, is what decides which vocabulary a compile targets.

## Proven at every layer, not just where it was easiest

Each change was confirmed by deliberately breaking it and watching a
real test fail before restoring it — the same discipline as every
other bundle this session:

- `isKnownField`'s vocabulary parameter dropped from `validateRule`'s
  call chain — an expense field silently validated under the invoice
  vocabulary.
- The same drop inside the compiler's own `parseModelOutput` — a
  hallucinated invoice field was silently accepted while compiling an
  expense rule.
- `compile-route.ts`'s vocabulary lookup removed — the same
  hallucinated field silently succeeded (`201` instead of `422`)
  through the real HTTP route, not just the underlying function.

## A new permission category, added for the same reason AR's was

No `Expense.*` category existed anywhere in the closed permission
vocabulary. Added — `Expense.Submit`, `Expense.Approve`,
`Expense.Review` — matching the exact precedent `AR_PERMISSIONS`
already set: listed now, unenforced by any route today beyond the
workflow engine's own dynamic permission check, so the vocabulary
doesn't need reshaping later when real Expense functionality exists.

## The Expense field vocabulary: authored, not translated, and deliberately small

`category`, `amount`, `currency`, `submitted_date`, `employee_id`,
`cost_centre`, `receipt_attached`, `trip_end_date`, `description`,
plus one derived field (`employee.first_submission`, mirroring
`party.first_document`'s role). Deliberately plain, readable names —
not an invented "EX-N" numbering scheme mimicking `BT-*`, which would
falsely imply an external standard that doesn't exist. Decision
0015's own framing: legitimacy here comes from this review, not a
document. Sized to prove the mechanism, not to be a comprehensive
expense module — the same discipline as `ar-process.test.ts`'s own
illustrative AP process before it.

## The result: the harder hypothesis holds too

`test/expense-process.test.ts` proves a real expense rule — three
conditions, all genuinely new fields, none shared with
`INVOICE_FIELDS` — correctly matches a large, receiptless Travel
expense and spawns a real task requiring `Expense.Review`. The
load-bearing negative case wasn't "does the rule fire" — it was
whether a single differing field (`receipt_attached: true` instead of
`false`, everything else identical) correctly prevents it. It does.
A further case confirms `category: "Meals"` never fires a
Travel-specific rule even at the same amount. A fifth test confirms
Expense, AP, and AR processes and rule sets all coexist in the same
database with no shared state or cross-contamination.

This closes the loop decision 0021 opened: not just "does AP's own
data model generalize to a second use of the same document type," but
"does the vocabulary-sharing design hold for a domain with nothing
in common with an invoice at all." It does, with the same discipline
proving it that's been applied to every other claim this session:
real tests, real negative cases, real breakage watched and confirmed
before being trusted.

## What this still does not test

- **The real AI compiler**, again. Every expense rule here was seeded
  directly via D1. `compile.test.ts` does confirm the compiler
  function itself correctly builds an expense-flavored prompt and
  refuses a hallucinated invoice field — but nothing here has asked
  the real, deployed model to compile a genuine expense sentence from
  scratch. Still the single largest unanswered question across both
  the AR and Expense work.
- **A real, authored Expense process** intended for actual use. The
  process built here (Submitted -> Review -> Reimbursed) is
  illustrative, the same honest scope boundary `ar-process.test.ts`
  already named for its own AP process.
- **`DERIVED_FIELD_PREFIXES`** (`term.absent(...)`) stayed a shared,
  global list rather than becoming vocabulary-specific — a small,
  known imprecision: the concept is inherently invoice-specific (a
  Business Term being absent), and nothing currently stops it from
  being referenced, meaninglessly, in an expense rule. Not fixed here,
  since `buildVocabularyDoc` already omits explaining it in the
  expense prompt, and no expense field currently starts with
  `term.absent(` in practice.

## What's still open

- The real compiler test named above, for both AR and Expense.
- Real Accounts Receivable and Expense process definitions, if either
  is ever actually built out for production use.
- The `DERIVED_FIELD_PREFIXES` imprecision named above.
- Every open question decisions 0015 and 0018 already named (cost
  centre vs. `org_units`, hierarchy flow-down, the `agent_approve`
  question) — none of them touched by this bundle.
