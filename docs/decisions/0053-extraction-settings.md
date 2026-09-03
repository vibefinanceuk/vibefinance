# 0053 — Extraction assumptions become configuration

Status: built, 3 September 2026. Follows directly from 0052's own
warning.

## The problem with hardcoding

Decision 0052 added a check — *a line item must have a description* —
and recorded, at the operator's prompting, that it was provisional:
every extraction decision so far came from a sample of one, and
several belonged in customer configuration rather than platform code.

Recording that was not enough. The operator's answer:

> *"Perhaps not hard-code, and ship the product with a sample set of
> extraction rules, which can be changed by an administrator."*

That is a better shape, and the distinction is real. **Hardcoded
behaviour asserts "this is always true". A default asserts "this is
usually true, and here is where to change it."** An administrator can
inspect the second and cannot inspect the first — and a setting nobody
can see is indistinguishable from code.

## Settings, not rules — and why

Two designs were possible.

**Extraction rules proper**: natural-language, compiled, gated,
capable of conditions a settings approach cannot express. This is the
capture-rules half of the original extraction design.

**Configurable settings**: a small closed set of knobs, declarative,
no compiler, no activation gate.

The second was chosen because the provisional table in 0052 lists
*settings*, not *logic* — a line cap, a tolerance, a boolean, a
choice between two page-precedence rules. Building a compiler and an
activation gate for six values would be machinery in search of a
problem.

The operator's own Morrison Express example — *"for invoices from this
supplier, use the total that sums the lines"* — is genuinely
rule-shaped and does **not** fit this. That remains unbuilt, and the
distinction is now clear rather than blurred.

## What is configurable

Per intake channel, following `hybrid_pdf_fallback` (0042) and for the
same reason: one customer may have a scanner feeding clean invoices
and a mailbox receiving whatever arrives.

| Setting | Default | From |
|---|---|---|
| `requireLineDescription` | true | 0052 |
| `maxExtractedLines` | 25 | 0043 |
| `currencyTolerance` | 0.01 | 0044 |
| `conflictWinner` | first | 0046 |

**Every default is exactly the shipped behaviour**, so applying the
migration changes nothing until somebody edits a value. A migration
that silently altered how documents are read would be a far worse
thing to deploy.

`GET /intake-channels/:id/extraction-settings` returns the current
values **and the decision each came from** — so an administrator
reading it can find out *why* a setting exists, not only what it does.

## Two findings from building it

**Tolerance is stored in minor units.** A float column for a setting
that exists to solve a floating-point problem would be an unfortunate
shape. Stored as whole pence, divided on read.

**A comment asserted a safeguard that did not exist.** While handling
the interaction between the line cap and the partial-list rule, a
comment was written claiming `linesTruncated` stopped the line-sum
check running. It did not — `validateInvoiceFacts` had never known
about truncation, so a deliberately capped list would have produced a
spurious mismatch.

The comment was written before checking. It is now true, because the
check was built rather than the comment softened — but the sequence is
worth recording: a plausible-sounding comment is not evidence, and
this one would have documented a guarantee the code did not make.

## What this does not solve

- **The remaining provisional assumptions.** 0050's single-alternative
  limit and 0047's one-call-per-page are architectural rather than
  configurable, and stay as they are.
- **Extraction rules proper**, for anything condition-shaped.
- **The sample of one.** These are still defaults derived from a
  single German freight invoice. They are now *visible and editable*
  defaults, which is a real improvement and not the same as being
  validated against a real control set.
