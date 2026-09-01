# 0028 — Duplicate detection

Status: settled, 1 September 2026. Decision 0015 flagged this
explicitly as blocked on per-line evaluation; decision 0027 closed
that block. This closes the capability itself.

## A real, previously unadded field, found during design

`BT-1` (Invoice number) — the single most natural anchor for
duplicate detection, since the same supplier submitting the same
invoice number twice is, in the overwhelming majority of real cases,
either a genuine duplicate or an attempted double-billing — had never
been added to `INVOICE_FIELDS` at all. No rule could reference it
before this decision. Added deliberately, with its own description,
the same reviewed-not-inferred discipline this project's own
vocabulary file states about itself.

## A weighted score, not a boolean — landed on directly in conversation

The explicit ask was "not boolean true/false, but 80% likely." Landed
on a simple, explainable weighted formula rather than a fuzzy matcher:
supplier match is a hard gate (without it, nothing else is meaningful
evidence — two different suppliers with a coincidentally identical
amount is coincidence, not partial duplication), and given a matching
supplier, three signals sum toward `1.0`: an exact invoice number
match (`0.6`, the strongest signal), an exact total amount match
(`0.25`), and an exact issue date match (`0.15`). Deliberately exact
match only, no fuzzy string comparison — easy to explain to an
auditor, the same explainability-over-cleverness discipline already
applied to the scoring rules everywhere else in this project.

`invoice.duplicate_confidence` is exposed as a new derived field
purely because it's numeric and `greater_than` already exists in the
closed vocabulary — a customer's own "configurable threshold" needs
no new mechanism at all. It's just an ordinary rule condition,
authored the same way every other rule in this system already is.
"Workflow" use is that rule firing `assign_task`; "analytics" use is
directly querying the stored column. Both come for free once the
field is real — this was a genuine, elegant simplification, not
something engineered in afterward.

## A real prerequisite bug, found and fixed before it could hide the new field too

Investigating where the score should live surfaced something that
predates this decision entirely: `invoice_headers`' structured columns
(`supplier_vat_id`, `currency`, `mandate_channel`, and the rest) have
been stored purely for querying since decision 0017, but never
actually merged into what a rule sees when evaluating a persisted
invoice by id — only `facts_json` was ever read. A rule referencing
`mandate.channel` — the exact field decision 0023 specifically
enriched with real example values *so it could be used in rules* —
would never have seen a value for it. Confirmed directly, not
assumed: a real test proved the gap by deliberately removing the merge
and watching a genuine assertion fail.

Fixed generally, not just for the new field: every structured column,
including the two new ones this decision adds
(`invoice_number`/`BT-1`, `duplicate_confidence`), is now merged into
evaluated facts under its real vocabulary field name — only when
actually set. A `NULL` column must never overwrite a genuine value
already present in `facts_json`; this was checked explicitly, not
assumed to be safe by default.

## A deliberate choice about *which* invoice gets scored

The confidence score is computed and stored on the invoice being
*submitted*, never a retroactive rescore of anything already on file.
An earlier invoice shouldn't suddenly read as "a duplicate" just
because something similar arrives later — it was submitted first, and
was never a duplicate of anything at the time. Proven directly: a
test submits an original invoice (scoring `0`, correctly, since
nothing else existed yet), then submits a near-identical later one,
and confirms the *original's own* stored score is still `0` afterward.

The maximum score against any single candidate wins, not a sum across
multiple weak matches — proven directly with three invoices from the
same supplier, where a naive sum would have inflated the result.
Re-upserting the same invoice (a correction, not a new submission)
correctly never counts itself as its own duplicate, since the query
explicitly excludes the row being written.

## What's still open

- **The historical/queryable invoice-facts framework** — decision
  0015's third named gap. Duplicate detection uses a direct,
  targeted query against `invoice_headers`; a general framework for
  querying historical facts remains unbuilt.
- **Fuzzy matching** — deliberately declined for this version, in
  favor of exact-match explainability. A real, reasonable future
  enhancement if false negatives (a genuine duplicate with a
  typo'd invoice number) turn out to matter in practice.
- **Invoice numbers were never checked against `invoice_lines`** —
  this decision only concerns header-level duplication (one invoice
  document duplicating another), not line-level duplication within or
  across invoices.
- Cost centre vs. `org_units` — still genuinely unresolved, untouched
  by this bundle.
