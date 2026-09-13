# 0295 — Cost centre was never reachable, and two real fields just needed asking for

**Status: built.**

---

## What was reported

> This mock up was created earlier, but we have deviated a little. I
> do not see Due Date, PO Number, Cost Center on the card.

All three traced to real, distinct causes — checked individually
rather than assumed to share one explanation.

## Due date and Purchase order

Both are genuinely header-level fields, confirmed directly against
`shared/interpreter/vocabulary.ts`'s own `INVOICE_FIELDS` list. Neither
is mandatory under BIS Billing 3.0, so neither was in
`field-visibility-route.ts`'s own `DEFAULT_VISIBILITY` map — and
"everything else is hidden by default" is a deliberate, documented
policy from decision 0114: *"a field nobody chose to show is one
nobody has to scan past."* That policy already names its own
exception — *"a customer who wants it says so"* — and the real
customer, through the operator, now has. Both added to the default as
`edit`, with a comment explaining plainly that they're there by
request rather than by the standard's own requirement, so the
distinction isn't lost on whoever reads this next.

## Cost centre — a different kind of problem entirely

Not a configuration gap. `INVOICE_LINE_FIELDS` in the same vocabulary
file names BT-133 explicitly (`"BT-133", // line accounting/cost
centre reference`), and `field-visibility-route.ts` sets `line:
INVOICE_LINE_FIELDS.includes(field)` when building its own response.
BT-133 is structurally a per-line value — one figure per invoice line,
not one for the whole document — and `headerFields` filters every line
field out unconditionally. No amount of field-visibility configuration
could ever have put it on the Invoice header card. It was a genuine
mistake in the very first mock-up, carried through every later
revision without either side catching it, since a static mock-up
cannot fail the way live data can.

Removed from the curated card entirely — decision 0296 gives its own
account of what replaced the slot.

## What has coverage

`workers/vf-app/test/field-visibility.test.ts` had two tests that used
BT-13 as their own example of "a field nobody configured" — no longer
true once it joined the default. Both updated to use BT-3 (invoice
type), still genuinely unconfigured, checked directly before choosing
it. The full `vf-app` suite (70 files, ~1,500 tests, run in two
batches to fit the tooling's own time budget) passes clean. Two
pre-existing failures were found while running it — one in licence
token verification, one in database migration table classification —
confirmed unrelated by temporarily reverting this session's changes
and reproducing both failures identically beforehand. Neither is
addressed here; both are flagged separately.

vf-app: full suite green. No vf-ui changes in this record — see 0296.
