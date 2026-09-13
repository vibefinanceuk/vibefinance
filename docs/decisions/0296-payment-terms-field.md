# 0296 — Payment terms, built properly rather than folded into an existing field

**Status: built.**

---

## What was asked

> Perhaps you can replace the field Cost Center with Terms, which
> should be a header field.

Checked before building anything: unlike Due date and Purchase order
(decision 0295), payment terms did not exist anywhere in the system.
Not in the closed vocabulary, not extracted by the document parser,
and the one existing "terms" concept — the rule engine's own
`supplier.paymentTerms` — is a different thing entirely: what was
*agreed with the supplier* in the customer's own ERP, not anything the
invoice itself says, accessed through the rule-writing system rather
than the header-fields mechanism this card uses. Swapping it in would
have been wrong. Flagged directly, and confirmed with the operator
before starting: build it properly, as its own task.

## What "properly" meant

Every place a field has to be registered for the system to treat it as
real, touched deliberately rather than found by trial and error:

- **`INVOICE_FIELDS`**, the closed vocabulary itself
  (`shared/interpreter/vocabulary.ts`) — BT-20 added, with a comment
  naming it as the one entry in its section that isn't there because
  BIS Billing 3.0 requires it.
- **`INVOICE_FIELD_TYPES`** and **`FIELD_DESCRIPTIONS`** — type
  `text` (the standard itself defines no code list for payment terms;
  it's a free-text note), and a description distinguishing it plainly
  from `supplier.paymentTerms`.
- **The document parser** (`shared/ingestion/ubl-parser.ts`) — taught
  to read `cac:PaymentTerms/cbc:Note` from a real invoice's own XML.
  Handled as array-or-single-object, the same defensive pattern
  `findVatSchemeCompanyId` already uses a few lines above for exactly
  this shape of ambiguity in UBL documents, rather than assuming a
  parser always returns one or the other.
- **`DEFAULT_VISIBILITY`** — `edit`, the same treatment decision 0295
  gave Due date and Purchase order, for the same reason: not mandatory
  by the standard, visible because the real customer asked.
- **The UI string label** (`field.bt-20`, "Payment terms" /
  "Zahlungsbedingungen") — a migration, following the established
  pattern.
- **The curated card itself** — BT-20 takes the slot Cost centre never
  should have held, alongside Purchase order in the third column.

## The safety net that caught the one step that would have been easy to skip

`shared/interpreter/field-coverage.test.ts` — a test that checks every
field the vocabulary declares can actually be populated by some real
intake path — failed the moment BT-20 was added to `INVOICE_FIELDS`
and nothing else: *"Declared in the vocabulary and populated by no
intake path: BT-20... A field nothing can produce is a rule nobody can
write."* This is exactly the risk a rushed version of this change
would have shipped — a field that exists, has a label, even renders a
box on the card, and is permanently, silently empty on every real
document because nothing ever fills it. The test caught it before
anything shipped, not after; the parser change above is what made it
pass.

## What has coverage

The `field-coverage` test itself, now passing. The full `shared`
package suite (272 tests) run clean apart from the two pre-existing,
unrelated failures already named in decision 0295. `vf-licence`'s own
"every declared field has a label" test — driven directly by the
vocabulary, not a hand-maintained list — picked up `field.bt-20`
automatically once the migration landed, with no separate list to
remember to update. On the card itself: a test confirming Payment
terms renders in Purchase order's own column, probed by removing it
from that column and confirming exactly that test fails.

shared: 272 tests (2 pre-existing, unrelated failures noted, not
introduced here). vf-app: full suite green. vf-licence: 320. vf-ui:
see decision 0297 for the pop-out's own coverage.
