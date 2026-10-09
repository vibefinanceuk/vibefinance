# 0703: An emailed invoice's reading is told what its supplier's invoices look like

**Status: built**, not yet pushed. vf-app `layout-hints.ts`, extraction and capture
changes, migration `0156_sender_lookup_index.sql`. No vf-ui or vf-licence change.

## What was asked

Step 3b of `docs/design/supplier-layout-learning.md`. Dan, 9 October 2026, when
offered it as its own decision: *"yes - please go ahead"*.

## The problem it had to solve first

A layout belongs to a supplier, and the supplier is matched only **after** reading,
on what the reading found (`match-supplier.ts`, 0209). So the supplier has to be
known from what is there on arrival. For an emailed invoice that is **who sent it**:

1. **The supplier's own email address.** The sender is the `email` of exactly one
   supplier. Two suppliers sharing an address are not guessed between.
2. **What this sender's invoices have turned out to be.** At least two earlier
   invoices from the same address (compared without case, display name ignored),
   and at least four in five of them from one supplier. A shared scanner or an
   accounts mailbox that forwards many suppliers' invoices does not qualify.

Otherwise nothing is said and the invoice is read exactly as before. Reading a VAT
number from a PDF's own text first (the design's second way) is left for later:
a PDF with text is read from its text, where position hints matter least.

## What the reading is told

A paragraph added to the extraction prompt (the header reading, not the separate
lines reading, which has no use for header labels):

> This invoice is very likely from Lager Nord GmbH, whose invoices have been read
> before. On their invoices:
> - the invoice number follows the label "rechnungsnr", near the top right.
> - the total with VAT follows the label "gesamtbetrag", near the bottom right.
>
> Labels are given in lower case without spaces or punctuation; … Use this to find
> each value, but report only what this document shows: where it differs, the
> document is right.

- **Labels first, positions roughly** (top, middle or bottom; left, centre or right;
  the page where a layout spans several): the vision model reads labels far better
  than it measures.
- **One layout, or one used on at least two in three of the supplier's invoices:**
  labels and positions. **Several and none usual:** labels only, every label each
  field has been seen beside ("gesamtbetrag" or "summe").
- Only the header fields the design names (§5, decision 1).
- **The document always wins**, said in the prompt.

## Recorded on the invoice

`intake.layoutHint`, for example *"Lager Nord GmbH (supplier's email address):
BT-1, BT-112"*. So a helped reading can be told from an unhelped one: the basis for
measuring whether hints mean fewer corrections (design §4).

## Cost

A few hundred prompt tokens on a helped reading; no extra call. Paths that read
with the model get it: an emailed scan, photo or ordinary PDF, read on arrival,
by the overnight reader (0687, 0696) or on Reprocess. An upload with no sender, and
structured invoices (UBL, Factur-X, supplier XML and CSV mappings), are unchanged.

## Index

`0156` indexes `route_messages` by `lower(counterparty)`, for finding a sender's
earlier invoices.

## Checked

- `layout-hints.test.ts` (15): addresses taken from display names and compared
  without case; a supplier known by its own email address; two suppliers sharing one
  not guessed between; known from a sender's history at two invoices, not one; a
  sender whose invoices are from several suppliers not taken for one; the hint's
  labels and positions, labels only across several layouts, none without a layout;
  the prompt carries it and is unchanged without; end to end through
  `handleCaptureFromSource` with an emailed scanned PDF: the header reading told,
  the lines reading not, and `intake.layoutHint` recorded; an unknown sender read as
  before.
