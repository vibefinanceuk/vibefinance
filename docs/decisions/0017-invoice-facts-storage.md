# 0017 — Invoice facts storage

Status: settled, 31 August 2026. The second buildable slice out of
decision 0015's design, following Teams (0016) — chosen specifically
because it directly attacks two of that document's three named gaps
at once: no line-item facts, and no queryable invoice history. Every
piece of the closed rule vocabulary and the interpreter's own pure-
function design is unchanged; this is new persistence, not a new
evaluation mechanism.

## The gap this closes

Nothing in this system had previously persisted invoice *facts* —
only evaluation *outcomes* (`invoice_runs`: id, `invoice_id`,
`rule_set_id`, outcome). "Find other invoices from this supplier,
same amount, within 30 days" (decision 0015's duplicate-detection
example) and "evaluate this line against its own cost centre's
threshold" were both unanswerable — this bundle is what makes both
questions answerable, though it stops short of building either
feature itself.

## Schema: queryable columns for what's searched, opaque JSON for the rest

`invoice_headers` (supplier VAT id, currency, issue date, total —
each a real column) and `invoice_lines` (line number, description,
amount, cost centre) both carry a `facts_json` blob for everything
else. The same split `rule_versions` already uses (`version` promoted
to a real column out of an otherwise-opaque `compiled_json`), applied
here for the same reason: index what's actually searched on, keep
everything else flexible rather than pre-deciding every column a
future consumer might want.

`cost_centre` is stored as a plain string, deliberately not yet a
foreign key to `org_units` — decision 0015 left open whether a cost
centre *is* an `org_unit` or a genuinely separate concept. Storing it
now, unenforced, means that question can be resolved and the column
properly constrained later without a schema rework — the same
"add now, clearly flagged" precedent as `org_users.locale`.

`invoice_headers` deliberately has no foreign key to any one
`rule_set` — which rule set governs an evaluation is a per-request
decision (`POST /rules/evaluate`'s own `ruleSetId` parameter), not a
fixed property of the invoice. A single invoice may reasonably be
evaluated against different rule sets at different points once the
workflow engine (decision 0015) exists.

## A deliberate divergence from how rules are versioned

`rule_versions` rows are immutable once created — a new version
supersedes the old one, but neither is ever mutated. Invoice facts are
the opposite: `invoice_headers`/`invoice_lines` support real updates
(`POST /invoices` is an upsert), because decision 0015's fact-
producing agents are explicitly meant to enrich an invoice's facts
over its lifecycle (a duplicate-match score, say) before each stage's
evaluation runs. This is a real, considered difference, not an
oversight — invoice facts are "current state," rules are "versioned
history," and the two data models earn their different shapes.

The upsert is a genuine replace, not a merge: calling it again for the
same id fully replaces the line set. Proven, not assumed — the
line-clearing delete was deliberately removed and the resulting
partial-merge bug was caught immediately by the schema's own
`UNIQUE (invoice_id, line_number)` constraint before being restored.

## Extending `POST /rules/evaluate`: `facts` becomes optional

When omitted, persisted facts are loaded from `invoice_headers` by
`invoiceId` instead. `invoiceId` was already a required field (used
for the execution log regardless of where facts came from), so it
does double duty as the fact-lookup key rather than introducing a
third, easily-confused field alongside the existing `ruleSet`/
`ruleSetId` pair. Inline `facts`, when provided, always wins — proven
directly with a test where the persisted facts would have matched a
given rule and the inline facts deliberately would not, confirming no
silent preference for one source over the other.

This reads *current*, potentially-mutable state, not a frozen
snapshot — the natural consequence of facts being upsertable rather
than versioned (see above). Anyone needing a specific, frozen
point-in-time reproduction still has the inline `facts` path,
completely unchanged — the same reproducibility escape hatch decision
0007 already established for rules, extended here to facts.

Backward compatible by construction: every existing caller that
already supplies `facts` sees zero behavioural change — confirmed by
the full existing test suite passing unmodified before any new
coverage was added.

One test-writing lesson worth recording: the first version of the
by-`invoiceId` test reused an existing rule set whose conditions
(`is_empty`, `not_in`) both evaluate true even on completely empty
facts — meaning it would have passed whether or not persisted facts
were genuinely loaded at all. Replaced with a rule requiring an exact,
present value before the test was trusted.

## What this bundle deliberately does not do

- **No document parsing.** `POST /invoices` accepts already-extracted
  facts as JSON — the same shape `/rules/evaluate`'s own inline
  `facts` already takes. It does not parse a PDF, XML, or JPEG; that
  remains the separate, still-unbuilt ingestion path decisions 0013
  and 0015 both already named as missing.
- **No per-line evaluation.** Lines are stored, but nothing loops over
  them to evaluate a rule per line yet — decision 0015 named this
  explicitly as the workflow engine's job, not this bundle's.
- **No historical query methods** (the "find similar invoices"
  framework decision 0015 described as one shared interface with
  purpose-built methods) — this bundle is the storage the framework
  would query against, not the framework itself.

`POST /invoices` reuses the existing `AP.Validate` permission rather
than introducing a new one — storing an invoice's facts is treated as
naturally part of the same "an invoice enters the system" capability
`/rules/evaluate` already requires that permission for. Licence-gated
the same way `/rules/evaluate` and `/rules/compile` already are, since
this is real product usage, not administrative setup — a different
category from `/org/*` and `/org/teams`.

## What's still open

- The three items in "what this bundle deliberately does not do,"
  above — document ingestion, per-line evaluation, and the historical
  query framework, all still unbuilt.
- Cost centre vs. `org_units` — still unresolved, per decision 0015.
- No `GET` endpoint to read back a stored invoice's facts — matches
  the "raw API for now" precedent elsewhere in this project, not an
  oversight.
