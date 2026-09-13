# 0297 — Header Fields reads in one deliberate order now

**Status: built.**

---

## What was asked

> Can you also re-order the fields in the pop-out to match what is in
> the mockup?

The pop-out previously listed fields in whatever order the
field-visibility API happened to return them — a customer's own
`sort_order`, set for other purposes, rather than a sequence anybody
had chosen for this specific view.

## The fix

`HEADER_FIELDS_ORDER`, an explicit thirteen-field sequence matching
the operator's own mock-up exactly: identity, then dates, then
references, then money, then what's genuinely technical. `shown` is
sorted against it — `HEADER_FIELDS_ORDER.indexOf(field)`, falling back
to the list's own length (sorting last, not first) for anything not
named.

**A field the sequence never named is not dropped.** A customer's own
custom field, or a header term not yet given a place in this list,
still appears in the pop-out — just after every field the sequence
does name, in whatever order it already had among the others like it.
The sequence is a preference about presentation, not a filter on what
gets shown; `openHeaderFieldsPopout()`'s own field selection — every
header field the stage configures, seller and buyer party fields
already excluded — is unchanged.

## What has coverage

Two tests. One gives the pop-out fields in a deliberately shuffled
order and confirms the rendered sequence still reads Invoice number,
Invoice type, Issue date, Business process — proving the sort is real
rather than incidentally already-sorted test data. The other includes
a field absent from `HEADER_FIELDS_ORDER` entirely and confirms it
still renders, positioned after every named field rather than
vanishing. Both probed by removing the sort call and confirming each
fails for the reason it was written to catch.

vf-ui: 371 browser tests (was 368), all new behaviour probed directly.
No migration.
