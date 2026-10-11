# 0726: Supplier network in, a source route

**Status: live**, pushed and deployed 11 October 2026 (`b215396`). vf-app (migration 0160,
`network-submission.ts`, `source-route.ts`, `source-capture-route.ts`, `routes-route.ts`),
shared (connector library), vf-ui (`network-source.js`, Process routes), vf-portal (sending),
vf-licence (strings migration 0330).

## What was asked

Dan, 11 October 2026, on invoice submission through the network: *"I'd like for this to somehow
leverage the routes capability we have created - perhaps facilitating a new source route?"* His
choices against the mock-ups: the customer **adds it as a source**; the **supplier picks the
company**; the supplier record is **the invitation's**; and the invoice is created in the network
as **Peppol BIS Billing 3.0** (0727). Step 2 of three (0725, 0726, 0727).

## What changed

**A route and a connector.** `network-in`, *Supplier network in*: gateway HTTPS, format UBL,
standard intake, into the process. In the Route library as an available source connector, one
per process. Its source is stored as an HTTPS source (the closed mechanism set is unchanged, as
Receipts in did); everywhere it is shown, it is shown as *Supplier network*.

**On Process routes.** *Supplier network* in Add source (until the process has one). Its panel
says what it takes, and **Accepts invoices for**: every company, or the companies ticked (a
company covers the units beneath it), with Choose. No business-unit default: the company is the
supplier's choice. `PUT /sources/:id/network-companies`, `Admin.Configure`.

**Receiving** (vf-app, portal access token only):
- `GET /portal/submission-companies`: the companies this person may send to, those their
  invitation names that a Supplier network source accepts.
- `POST /portal/submissions` `{ orgUnitId, filename, xml }`: refused unless the company is one
  the invitation covers (or beneath one), a source accepts it, and the XML is a UBL Invoice
  declaring Peppol BIS Billing 3.0. Then as every route: a `MSG-` message of the source (the
  sender is the person's login), the file stored before it is read, read by the ordinary capture
  path, into the source's process.
- **Placement** passed through capture: the company stands where a source's default would; the
  supplier is the invitation's, never matched off the document. Facts `intake.network` and
  `supplier.networkVatDiffers` (the document's seller VAT number is not the record's), for rules.

**The network** (vf-portal) asks each customer which companies take invoices
(`GET /api/submission-companies`) and posts an invoice to the customer a link is for
(`POST /api/submissions/:linkId`), with that customer's token and the invoice alone. The Create
form that uses them is 0727.

## Tests

- vf-app `network-submission.test.ts`: the source added once per process and shown as Supplier
  network; companies accepted, every one or those ticked and the units beneath; nothing offered
  or accepted without a source; an invoice arriving as a message of the source in the chosen
  company for the invitation's supplier; the invitation's supplier kept and the VAT difference
  flagged; a company not covered, and anything but BIS 3.0, refused; portal token only.
- vf-app `routes.test.ts`: the seeded routes include it.
- vf-ui `routes.test.ts`: offered once per process; its panel, no business-unit default, and
  saving the companies chosen.
- vf-portal: the companies per customer; the invoice posted to the right customer only.

## To deploy

Migrations: vf-app `0160_network_in.sql`, vf-licence `0330_network_source_strings.sql`. Deploy
vf-app, vf-licence, vf-ui and vf-portal. Then, to try it before 0727: add *Supplier network* to
the AP process on Process routes.
