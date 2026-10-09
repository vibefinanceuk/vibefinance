# 0706: Record New Supplier opens the form, filled from the document and from what was typed

**Status: built**, not yet pushed. vf-ui only.

## What was asked

Dan, 9 October 2026, with a screenshot of a scanned invoice from The Thornbury Deli,
stopped by Supplier Not Found:

> When I scan in a document from a new supplier, the option is to change seller, and
> then click record new supplier. However when I click record new Supplier, the message
> appears saying "a supplier needs a name".

## Why

Find a supplier's **Record New Supplier** (0233) recorded a supplier straight away from
the invoice's facts, with no chance to look at them. Its name came from the seller name
(BT-27) only. The reading had not got the seller's name off this scan (it is a logo
and a small address block at the top right), so the name was empty and vf-app refused
it, although Dan had typed the name into the search box just above.

The full **New Seller** form (0480) already asks for name, VAT number, email and
address, but is offered only on an invoice with no purchase order reference. This one
has one (PO:690000313), so Find a supplier was the only way, and it had no form.

## What changed

- **Record New Supplier opens the New Seller form** instead of recording blind. The
  form shows what will be recorded and saves as before: the supplier, then the invoice
  attached to it.
- **The name** is the document's seller name (BT-27), else **what was typed in the
  search box**. The VAT number (BT-31) and country (BT-40) are filled from the
  document as before; email and address are typed (the reading does not ask for the
  seller's address).

The PO note on the seller card (a PO invoice from an unknown supplier needs
investigating, not a new record) is unchanged; Find a supplier still offers Record New
Supplier, now through the form.

## Checked

- `viewer.test.ts`: Record New Supplier opens the form filled from the document, and
  saving it creates the supplier and then attaches the invoice; with no seller name on
  the document, the name typed in the search is used, with the document's VAT number
  and country.

## Not done here

The reading missing the seller's name on this scan is a reading problem, not a form
problem. Supplier layout learning (0701–0705) does not cover the seller name yet: it is
not among the header fields learned first (design §5, decision 1).
