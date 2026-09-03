# 0052 — A line item must have a description

Status: built, 3 September 2026. **Explicitly provisional** — see the
closing section, which matters more than the change itself.

## The phantom line

Page 2 of the freight invoice has no line table at all. It returned a
single row with a **null description** and an amount equal to the
document total — the totals block, reported as a line item.

Concatenated onto page 1's eight real charge rows, that gave nine
lines summing to 6,274.94 against a real figure of 3,137.47. So
`line_sum` could not pass however carefully the totals were corrected.

The prompt already says a line is *"not a subtotal, VAT line, or grand
total"*. It was ignored — the same finding as everywhere else this
week, and the reason this fix is code rather than another prompt
change.

## The narrowest check that catches it

Three options were considered:

- **Reject a line with no description.** Narrow, and encodes
  something true of real invoices.
- **Reject a line whose amount equals a stated total.** More targeted
  at this exact shape, and would drop a legitimate single-line
  invoice, where that shape is correct.
- **Surface it as a conflict.** Fits the pattern established by 0048,
  but does not stop the bad data being stored, and there is no obvious
  correct answer for a rule to choose.

The first was chosen precisely *because* it is narrow. It does not try
to infer intent from an amount, and the rule it encodes — a charge row
has a description — is a property of real invoices rather than a guess
about one document.

## An interaction that nearly caused a worse bug

A partial line list is discarded entirely (0044 addendum 2): a line
whose amount cannot be read means the list is incomplete, and a
partial sum produces a confident-looking mismatch.

That check compared `lines.length` to `rawLines.length` — so rejecting
the phantom would have made the counts disagree and thrown away the
**eight good charge rows** with it.

Rejected rows are now counted separately. A row that was never a line
item is not evidence that the real lines are unreliable, and the two
cases are genuinely different: *"we could not read this amount"* casts
doubt on the list; *"this was not a line"* does not.

## Provisional, and why that is recorded here

Raised in review, and the more important point:

> *"I'm conscious that with a different control set of documents, some
> of these decisions may take a different direction, and perhaps need
> to be handled in the extraction rule."*

**Every extraction decision this week comes from a sample of one** — a
German freight invoice with an unusual two-page structure where the
totals live on page 2 and page 1 ends with "to be continued". The
findings are real, and generalising from one document is exactly how a
platform acquires assumptions nobody remembers making.

*A line item must have a description* is a **platform-level
assumption**, and a customer whose invoices carry genuinely unlabelled
rows would need it relaxed. That is the shape of thing that belongs in
customer configuration, not in extraction code.

Decisions from this week that a different document set could
legitimately overturn:

| Decision | Assumption | Could be wrong when |
|---|---|---|
| 0052 | A line item has a description | Rows are identified by code alone |
| 0046 | First page wins a conflict | A later page is authoritative |
| 0050 | Only the first alternative matters | Three or more pages disagree |
| 0044 | A penny of tolerance | Long invoices accumulate rounding |
| 0043 | 25 lines is enough | A genuinely long itemised invoice |
| 0047 | One model call per page | A faster model, or larger budget |

None is wrong today. All are inferences from one document, and each
should be revisited against a real control set before being treated as
settled — several belong in per-customer configuration rather than
platform code.
