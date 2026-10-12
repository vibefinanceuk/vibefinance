# 0737: Goods receipts as rows of Documents, with a Type filter

**Status: live** at `b4798f6`, pushed and deployed 12 October 2026, migration 0338 applied. vf-app (`documents-route.ts`, `index.ts`), vf-ui (`documents.js`, `app.css`;
`app.css` copied to vf-portal), vf-licence (strings migration 0338). The first of two steps;
the second (sharing receipts with suppliers in the network) is below.

## What was asked

Dan, 12 October 2026: *"introduce more document types to the Documents search. For example
to include Goods Receipts as a row, and document type."* After the mock-up: *"please
proceed"*. Sharing with suppliers is agreed as the next step, configured in AP Setup with an
override on the supplier record (the supplier's setting wins).

## What changed

- **Receipts are rows.** `GET /documents` lists goods receipts beside invoices and credit
  notes, newest first: an invoice by when it arrived, a receipt by the day its goods did (the
  date its row shows), so the two interleave by the date a person reads. One page is chosen
  across both kinds with a `UNION ALL` of ids, then each kind's rows are read for those ids;
  `total` is the two counts added.
- **A receipt's row**, from its order (the first, where it names several): Supplier (the
  supplier on file for the order's seller, or the party the order names), Business unit, PO
  (every order it names). Received is the receipt date; Amount and Due are a dash. Status is
  the receipt's own: Registered, Being checked (pending in Warehouse Receipts), Rejected,
  Goods returned (registered, with goods sent back), Cancelled, each in the pill colour of the
  invoice state it is most like. Hands counts its process's tasks, as an invoice's. Opening
  the row opens the receipt's own pop-out, as on Goods Receipts and Tasks.
- **Type filter**: All types, Invoices, Credit notes, Goods receipts (`type=` on the route;
  an invoice's kind is `document_kind`, 0730).
- **Columns**: Type now first and on; a new **PO** column after the supplier (an invoice's
  BT-13, a receipt's orders), on. A column choice saved before is kept, with these two added
  once (`vf.documents.columns.v3`).

## Who sees receipts

Those who may see them on Goods Receipts: AP.Receive or AP.Validate (`receiptViewScope`),
where they hold it, narrowed to the chosen org, by the same rule (a receipt is in a unit when
an order it names is; an order in no unit is everyone's). Someone with AP.Review alone sees no
receipts and is not offered the type. Search (receipt number, delivery note, order number,
supplier), the unit filter and `since` apply to receipts too.

**Not under a drill-through.** Every card that opens Documents filtered (a stage, a person's
tasks, duplicates, Fraud Prevention, an agent's report …) asks about invoices; receipts are
left out there and the type list offers only invoices and credit notes. Nor in the AP
Assistant's search, which does not page.

## Next: receipts in the network

Agreed: AP Setup › Supplier Network, Goods receipts — Don't share (default) / Share with
suppliers, and Only once registered; on the supplier record's Supplier portal card — As AP
Setup / Share with this supplier / Don't share with this supplier, the supplier's choice
overriding AP Setup's. Then a portal route, the network's Type filter and a read-only receipt
view (ordered, received, rejected, returned, reason, delivery note; never the Chat or internal
comments).

## Tests

vf-app `documents-receipts.test.ts` (9): interleaving and order, a receipt's row and states,
pages across both kinds, the type filter, search, units and scope, none for AP.Review alone,
the AP Assistant or a drill-through, hands and stage, and the route's permissions.
`documents.test.ts` unchanged and passing. vf-ui `documents.test.ts`: the new defaults, the
Type column and a receipt's pill, the type filter with and without receipts, opening a
receipt, and keeping an earlier column choice. vf-licence string coverage. Checked in Chromium.

## To deploy

Migration: vf-licence `0338_documents_receipts_strings.sql`. Deploy vf-app, vf-licence, vf-ui
(and vf-portal, whose `app.css` copy changed).
