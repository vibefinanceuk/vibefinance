# 0748: A goods receipt's questions to the supplier, as an invoice's

**Status: live.** vf-app (`receipt-messages.ts`, `receipt-sharing.ts`, `receipt-timeline.ts`,
`supplier-messages.ts`), vf-ui (`goods-receipts.js`, `supplier-chat.js`,
`receipt-conversations.js`), vf-licence (strings migration 0346).

## What was asked

Decision 0740 left two things for later: no *Query raised* on a receipt, and no Tasks or
Conversations badge for supplier messages on receipts. Dan, 12 October 2026: *"yes, lets do
that so GR is brought in line with invoice behaviour"*.

## What changed

- **Ask supplier on a receipt**, beside Claim and Back, for whoever receives goods while
  someone at the supplier is linked (0740). As on an invoice (0721), it takes a question, the
  lines it is about and who will be emailed. The receipt does not move.
- **Query raised in the network** while the customer's question waits on the supplier, until
  they write back. It counts in the network's status filter, as an invoice's does.
- **A banner on the receipt here**, as on an invoice: *Asked {supplier} on {when} ({who}),
  awaiting their reply*. `GET /goods-receipts/:id/supplier-messages` gains `awaiting` and
  `query`.
- **The supplier's messages in Conversations** (0660), at the top of Tasks and of Goods
  Receipts, and so in those menu items' counts. A message is shown to everyone it was emailed to
  (0740: who recorded the receipt, who receives goods for its company, who last wrote to the
  supplier) until they catch up by opening the receipt or pressing Done. The row says *From
  the supplier* and quotes them when theirs is the latest.

On an invoice, a supplier's reply reaches whoever holds its task, by email and on the invoice.
A receipt usually has no open task, so Conversations is where it reaches the people told.

## Tests

- vf-app `receipt-messages.test.ts`:
  - a question raises Query raised and the banner's `query`, and the supplier's reply ends
    both;
  - a plain message raises nothing;
  - a supplier message is in Conversations for those emailed, never for someone who was not,
    leaves on Done and comes back with the next one.
- Existing receipt, sharing, timeline and portal tests are unchanged and pass.
- vf-ui `goods-receipts.test.ts`: Ask supplier posts `{ body, ask, lines }` and reopens the
  receipt; the banner; no Ask without anyone to ask.
- vf-ui `receipt-conversations.test.ts`: the *From the supplier* tag, the quote and the count.
- vf-licence string coverage.

## To deploy

Migration: vf-licence `0346_receipt_query_strings.sql`. Deploy vf-app, vf-licence and vf-ui.
