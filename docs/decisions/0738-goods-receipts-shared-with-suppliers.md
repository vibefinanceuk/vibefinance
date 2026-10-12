# 0738: Goods receipts shared with suppliers in the network

**Status: built.** vf-app (`receipt-sharing.ts`, `portal-route.ts`, `index.ts`, migration
0164), vf-ui (`receipt-sharing.js`, `ap-setup.js`, `suppliers.js`, `src/index.ts`), vf-portal
(`receipt-view.js`, `portal.js`, `shell.js`, `portal.css`, `src/network.ts`, `src/index.ts`),
vf-licence (strings migration 0339). The second step after 0737.

## What was asked

Dan, 12 October 2026, on goods receipts in Documents: *"This could also be shared to the
supplier via the portal as well"*; *"sharing receipts should be configurable. Perhaps that
happens in AP setup. It could also happen in the supplier record where invites occur"*. Agreed:
both, the supplier's setting overriding AP Setup's. *"yes, please go ahead"*.

## What changed

- **AP Setup › Supplier Network** (a new tab, Admin.Configure): Goods receipts — **Don't
  share** (the default) or **Share with suppliers**; and **Only once a receipt is registered**
  (on by default), so a receipt still being checked is not shown. It says how many suppliers
  have their own setting. Stored in `network_sharing_config`.
- **The supplier's page**, on its Supplier portal card, under the people and invitations:
  **As AP Setup** (saying what AP Setup says now), **Share with this supplier**, **Don't share
  with this supplier**. Saved when chosen; seen with AP.Supplier, changed with
  Supplier.Maintain. Stored in `supplier_receipt_sharing` (no row: as AP Setup). **The
  supplier's setting wins.**
- **In the network**: a customer that shares receipts with the supplier sends them in its
  Documents answer beside the invoices (its own newest 500), newest first by receipt date,
  and says so (`receipts: true`); the network then offers **Goods receipt** in the Type filter
  and the receipt statuses — **Goods received**, **Part returned** (goods sent back),
  **Being checked** (only where AP Setup allows pending ones) — also explained in Help. Search
  finds a receipt by its number, delivery note or order.
- **A receipt, opened** (read only, `GET /portal/receipts/:id`): the customer, company,
  receipt date, delivery note and PO; per line the order and line, item, quantity ordered,
  received, rejected and returned, the unit, and the return reason from the customer's list.

## Which receipts a supplier sees

A receipt naming an order whose seller is this supplier — by its VAT number however written
(without country prefix, spaces or dots, as credit notes match, 0731) or its ERP number — in a
company the invitation covers or a unit beneath it. Never a cancelled or rejected receipt.
**Never** a receipt's notes, a line's note, why a line was rejected in checking, who recorded
it, or its conversation. The same 404 for one that does not exist, is another supplier's or
company's, or is not shared.

## Tests

vf-app `receipt-sharing.test.ts` (9): AP Setup and the supplier's setting and which wins;
none while nothing is shared; the supplier's own, by VAT or ERP number, for the linked
companies, registered and not cancelled; pending where allowed; search and status filter; a
receipt opened line by line with nothing of the customer's notes; the same 404s; the
routes' permissions. `portal-route.test.ts` unchanged and passing. vf-portal: the network's
`receipts` flag and opening a receipt from its customer only; the words test reads
`receipt-view.js`. vf-ui `receipt-sharing.test.ts` (4), and the proxy test carries the two new
routes. vf-licence string coverage. Checked in Chromium, Day and Night.

## To deploy

Migrations: vf-app `0164_receipt_sharing.sql`, vf-licence `0339_receipt_sharing_strings.sql`.
Deploy vf-app, vf-licence, vf-ui and vf-portal.
