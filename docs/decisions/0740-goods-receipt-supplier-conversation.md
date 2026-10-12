# 0740: The conversation with a supplier about a goods receipt

**Status: live** at `c0a7b8a`, pushed and deployed 12 October 2026, migrations 0165 and 0341 applied. vf-app (`receipt-messages.ts`, `receipt-sharing.ts`, `supplier-messages.ts`,
`index.ts`, migration 0165), vf-ui (`goods-receipts.js`, `supplier-chat.js`, `src/index.ts`),
vf-portal (`receipt-view.js`, `portal.js`, `src/network.ts`, `src/index.ts`), vf-licence
(strings migration 0341).

## What was asked

Dan, 12 October 2026: *"introducing Supplier collaboration / chat with Goods Receipts in the
same way as we have with Invoices and Credit notes for consistency"*. After the advice and the
mock-up, *"yes"* to building it as one step, with the four points as proposed.

## What changed

- **One message store.** `supplier_messages` (0721) now holds a receipt's messages too: a
  message has an `invoice_id` or a `receipt_id`, never both (rebuilt in migration 0165; nothing
  pointed to it). What a supplier's person has read of a receipt's messages is kept in
  `portal_receipt_reads`, beside `portal_reads`.
- **In the app**, the receipt pop-out has a **Supplier** tab beside Attachments and Timeline /
  Chat, with its count: the invoice's own conversation (`buildSupplierTab`, now given the
  receipt's address), apart from the internal Timeline / Chat. Read by whoever may see receipts
  (AP.Receive, AP.Validate); written by whoever receives goods (AP.Receive). The warehouse may
  start the conversation.
- **In the network**, a receipt opened shows the messages with the customer on the right, as an
  invoice does; its row in Documents has the same "1 new" pill and counts towards the menu's
  badge; opening it reads them. The line above it now says to write here.
- **Email both ways**, as for invoices: the warehouse's message to everyone at the supplier
  linked for the receipt's company (or above); the supplier's to **the person who recorded the
  receipt, everyone holding AP.Receive for its company (in it, above it, or everywhere), and
  whoever last wrote to them** — never AP unless they wrote.

## Only while shared

The warehouse can write, and the supplier can see and write, only while the receipt is one the
supplier sees in the network (0738): shared with them (AP Setup or their own setting), and not
pending where only registered receipts are shown, rejected or cancelled. Turned off later, the
conversation leaves the network and stays on the receipt in the app. The supplier is matched to
the receipt by its order's seller (VAT number however written, or ERP number), as 0738.

**Not yet** (agreed): no *Query raised* on a receipt — unread counts only; no Tasks or
Conversations badge for supplier messages on receipts.

## Tests

vf-app `receipt-messages.test.ts` (6): nobody to write to until shared, then the supplier's
people for the company; a supplier set to don't share loses the network side while the app
keeps the conversation; the supplier writes and the recorder, the company's receivers and
everyone-receivers are emailed (not another company's); the same 404 for a receipt not shared;
unread counts and reading on opening; the route's permissions. `supplier-messages`,
`receipt-sharing` and `portal-route` tests unchanged and passing. vf-ui: the Supplier tab and
writing to the receipt's address, none when not shared; the proxy test. vf-portal: replying to
a receipt goes to the receipt. Checked in Chromium.

## To deploy

Migrations: vf-app `0165_receipt_supplier_messages.sql`, vf-licence
`0341_receipt_messages_strings.sql`. Deploy vf-app, vf-licence, vf-ui and vf-portal.
