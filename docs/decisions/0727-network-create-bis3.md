# 0727: Create an invoice in the network, as Peppol BIS Billing 3.0

**Status: live**, pushed and deployed 11 October 2026 (`b215396`). vf-portal (`create.js`, `bis3.js`,
`shell.js`, `portal.js`, `portal.css`), vf-app (`network-submission.ts`: the seller, buyer and
purchase orders), vf-licence (strings migration 0331).

## What was asked

Dan, 11 October 2026: *"Can we format the submitted invoice in the native PEPPOL BIZ 3.0?"*,
chosen as *the supplier creates it as BIS 3.0*; then the mock-up in the app's invoice-viewer
layout (*"Perhaps try to make similar to this. With the exception of Payment Box in top
right"*), in the app's frame (0725): *"looks good I like it"*. Step 3 of three (0725, 0726, 0727).

## What changed

**Create**, in the network's side menu. The supplier makes the invoice here:

- **Seller** and **Payment**: the customer's record of the supplier, its bank account included
  (`agreed_account_identifier`), shown and not editable. A change to the record, above all the
  account, is the customer's (bank detail changes are a later phase).
- **Buyer**: the company chosen, across every customer that takes invoices through the network
  (0726), with its legal details as the customer keeps them (VAT number, address, Peppol ID; a
  unit without its own takes the nearest company above it).
- **Invoice header**: number, issue and due dates, currency, purchase order, buyer reference, and
  the net, VAT and total worked out from the lines. Type is Invoice (380); a credit note can
  follow in the same form.
- **Invoice lines**: description, PO line, quantity, unit (UN/ECE codes), unit price, VAT category
  (standard with its rate, zero rated, exempt, reverse charge) and net; Add line and remove. An
  exemption reason when a line is exempt or reverse charged. An optional supporting PDF, up to
  5 MB, carried inside the e-invoice.
- **From a PO** (top bar): one of that customer's active purchase orders for this supplier fills
  the PO number, currency and lines.
- **Checked as they type** against a working set of EN 16931 and Peppol rules (BR-02, BR-03,
  BR-05 to BR-11, BR-16, BR-22 to BR-27, BR-S-05, BR-S-08/09, BR-E-10, BR-AE-03, BR-CO-09,
  BR-CO-25, BR-61, PEPPOL-EN16931-R003, R010, R020): each failure named, its field marked red as
  in the app's viewer, and Send kept off until there are none.
- **Send to {customer}** writes Peppol BIS Billing 3.0 UBL and sends it through the customer's
  Supplier network source (0726); Documents then says it was sent, with the reference.
  **Download the XML** keeps a copy. **Discard** starts again.
- **A draft is kept in that browser only** (the network keeps nothing) and cleared when sent.

`bis3.js` (the totals, the rules, the XML) is plain functions shared by the page and the tests,
including the customer's instance's, which reads what it writes.

**vf-app**: `GET /portal/invoice-parties` and `GET /portal/purchase-orders` (portal token, a
company the invitation covers), and vf-portal's `GET /api/customers/:linkId/…` to reach them.

## Afterwards: the cards level, and Day's colours for what to put right

Dan, from the deployed network in Night: *"align the Payment card so that it is the same height
as the buyer and seller cards"*, and the fields to put right and the *Not ready to send* panel
in Day's lighter colours, not deep red. The three cards now stretch to the tallest; a line's
field to put right, the check and the sent notice use the fixed severity colours the app's own
fields use (`--severity-danger-bg` and its text), in both themes.

## Afterwards: a VAT number kept without its country code

Dan's screenshot showed The Thornbury Deli's record keeping its VAT number as `111350965`, which
the form read as no VAT number at all. A VAT number kept as digits now takes the record's
country code in front (`GB111350965`, Greece's `EL`) for the electronic address and the invoice,
and the customer's instance compares the two with or without the code, so such an invoice is not
flagged as a different supplier.

## Not in this

Sending through a Peppol access point (this is the format, through our own network); credit
notes (381); a full Schematron validation (the rules a person filling the form can break are
checked; the customer's instance reads the result exactly either way).

## Tests

- vf-portal `bis3.test.ts`: totals per category and rate, the rules with their fields, the
  electronic address from the record or the VAT number, the XML in UBL's order, escaped, with no
  empty element.
- vf-app `network-submission.test.ts`: an invoice the builder writes is read exactly (number,
  dates, PO, buyer reference, both VAT numbers, totals, lines); the seller and buyer as the
  customer keeps them; the supplier's open POs for the company and units beneath, with lines.
- vf-portal: every `network.…` word the pages and the builder use is defined in English and
  German. Driven in Chromium: From a PO, the check failing then passing, Send, Documents.

## To deploy

Migration: vf-licence `0331_network_create_strings.sql`. Deploy vf-licence, vf-app and
vf-portal. For an invoice to pass, the customer's records need the supplier's country and VAT
number (or electronic address) and the company's country and VAT number (or Peppol ID); the form
says which is missing.
