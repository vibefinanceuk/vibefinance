# 0701: Where each header value is on its document is recorded

**Status: live** at `2165798`, pushed and deployed 9 October 2026, migrations applied. vf-app migration `0154_invoice_field_regions.sql`,
`field-regions.ts`, routes `GET /invoices/:id/regions` and `PUT /invoices/:id/regions/:field`;
vf-ui; vf-licence migration `0313_value_from_document_strings.sql`.

## What was asked

Step 1 of `docs/design/supplier-layout-learning.md`. Dan, 9 October 2026, on the
design and its four proposed decisions: *"Agreed with this proposal"*.

## What it does

**Records where a value is.** The viewer already knows, the moment it finds a value
or a person boxes one in. It now tells vf-app, quietly, never holding anyone up:

| `source` | When | Recorded by |
| --- | --- | --- |
| `found` | A clicked field's value was found **without doubt**: once on the document, or beside its own label (design §5, decision 4) | the form, on the viewer's `located` answer |
| `lassoed` | A person boxed a value in and it went into the field | the form, after filling |
| `lassoed_corrected` | As `lassoed`, and the field had a different value before | vf-app, from `previous` |

Each row holds the page, the box (fractions of the unrotated page), the label
beside it (`labelBeside`: the words to its left, else the line above; squashed, so
`Gesamtbetrag:` is `gesamtbetrag`), the value, who and when. One row per invoice and
field, the latest word, except that a `found` region never replaces a lassoed one
for the same value: a person pointing outranks the viewer searching.

Header fields only (`BT-n`), as the design says; lines are step 4.

**A region counts only while its value is the invoice's.** A person may box a value
in and never save it, or change it later. `listRegions` marks each region `current`
only while its value still matches the stored fact (numbers by amount, text
without case or punctuation). Learning (step 2) will read only current regions.

**A value taken with the box is shown exactly there.** When a field is clicked whose
current value was boxed in, the viewer outlines the recorded box rather than
searching again, and does not record it again.

**The audit line.** A boxed-in value, saved, is a Timeline entry: *"Dan took Invoice
total from page 1 of the document"*, or *"… corrected Invoice total from page 1 …"*
when it replaced a different value. Found regions are not a person's act and make
no line; a value boxed in and then changed makes none either.

## The routes

`GET /invoices/:id/regions` and `PUT /invoices/:id/regions/:field`, gated as the
document is (AP.Validate, AP.Code, AP.Match, or a collaborator). `recorded_by` is the
signed-in person, never taken from the request. Both added to vf-ui's proxy list
and its screen-call test.

## For the runtime-data wipe

`invoice_field_regions` references `invoice_headers`: a script that clears invoices
must clear it first (`DELETE FROM invoice_field_regions;`), as it must
`invoice_pages` (0690).

## Checked

- `field-regions.test.ts` (15): found with its label; a lasso that replaced a different
  value is a correction, one that did not is not; found does not replace lassoed; a
  region whose value changed is not current; line fields, missing or off-page boxes,
  empty values and unknown sources refused; 404; the Timeline line only for a person's
  box whose value was kept, and in the activity feed; PUT and GET as the signed-in
  person; 401 and 403.
- `lasso.test.ts`: a boxed-in value recorded with its label and what it replaced; a
  value found beside its label recorded once, however often clicked; a value found
  twice with nothing to tell the places apart not recorded; a value taken with the
  box shown at its recorded place and not recorded again.
