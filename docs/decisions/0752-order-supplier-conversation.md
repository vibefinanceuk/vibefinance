# 0752: The conversation with a supplier about a purchase order

**Status: live.**

- vf-app: migration 0169, `order-messages.ts` (new), `order-sharing.ts`, `purchase-order-route.ts`,
  `index.ts`.
- vf-portal: `src/network.ts`, `src/index.ts`, `public/portal.js`, `public/order-view.js`.
- vf-ui: `purchase-orders.js`, `receipt-conversations.js`, and the proxy.
- vf-licence: strings migration 0350.

## What was asked

Dan, 13 October 2026: *"Lets add conversation capability for an order"*, the follow-up 0751
left:

> A conversation about an order: Ask supplier, Query raised and Conversations, as goods receipts
> now have.

## What changed

The same conversation as an invoice's (0721) and a goods receipt's (0740, 0748), about a purchase
order.

### Where it is kept

- **Its own table, `purchase_order_messages`**, of the same shape as `supplier_messages`.
  - `supplier_messages` holds a standing invariant (0165) that each message is about exactly
    one invoice or one receipt, and the migration runner re-checks it. Widening it would mean
    rewriting a migration already applied.
  - Its own CHECK carries 0158's rule: a message to the supplier has its author here, and one
    from the supplier has its author's email.
- **Keyed by the order's number**, as receipts name orders (0644). An order's row is rewritten
  when a change replaces it (0081, 0750), and the conversation stays with it.
- `portal_order_reads` is what a supplier's person has read (as 0728).
- `purchase_order_reads` is what a person here has caught up on, for Conversations (as 0660).

### Here

- **On the order's pop-out on Purchase Orders**, beneath what was received:
  - *The conversation with the supplier*: who it goes to, the messages, and a box to write in;
  - **Ask supplier**, beside Hold and Close, for AP.Purchasing or Admin.Configure. It takes a
    question, the lines it is about, and who will be emailed. *The order stays as it is.*
  - While a question waits, the amber banner: *Asked {supplier} on {when} ({who}), awaiting
    their reply*.

  It is offered while the order is shared with its supplier (0751, including AP Setup's date)
  and someone there is linked for its company, or when a conversation already exists.
- **Endpoints:**
  - `GET /purchase-orders/:number/supplier-messages` (AP.Validate, AP.Purchasing or
    Admin.Configure). Reading it catches the reader up for Conversations.
  - `POST` writes, with `ask` and `lines` (AP.Purchasing or Admin.Configure).
  - `POST …/supplier-messages/seen` is Conversations' Done.
- **Opening an order needs AP.Validate or now AP.Purchasing** (`GET /purchase-orders/:number`),
  each in its own companies. Purchasing can then open the order Conversations points to.

### In the network

- The opened order (0751) shows the conversation on the right, with a reply box, as a receipt's
  does.
- **Query raised** replaces the order's own status while a question waits, until the supplier
  writes back.
- Documents counts what the customer wrote that this person has not read. Opening the order reads
  it.
- `POST /portal/orders/:id/messages` gives the same 404 for an order the supplier may not see as
  for none. vf-portal sends it on `/api/orders/:linkId/:id/messages`.

### Who hears of a supplier's message

The order's **buyer** (`purchase_orders.buyer_user_id`), **everyone holding AP.Purchasing** for
its company (in it, above it, or everywhere), and **whoever last wrote** to the supplier about it.
All active people only.

- They are emailed, with a link to the app.
- It is in their **Conversations** on Tasks, beside receipts, as *Purchase order {number} ·
  company*, tagged *From the supplier* with the count and the message quoted. It counts in the
  menu.
- Open shows the order's pop-out with its conversation; Done catches up without it. It comes back
  with the supplier's next message.

### Words (vf-licence 0350)

3 keys, in English and German. The rest are the receipt conversation's and the Ask supplier
dialog's own.

## Tests

- **vf-app** `order-messages.test.ts`, 6 tests:
  - Purchasing writes only while the order is shared, and not before AP Setup's date;
  - Ask supplier: Query raised and unread in the network, the conversation on opening, read
    once opened, and the supplier's answer ends both;
  - the buyer, Purchasing for the company and everywhere are told, never Purchasing in another
    company;
  - the same 404 for an order not shared as for none, and an empty message refused;
  - Conversations: found for whoever was emailed, gone once the conversation is read, back with
    the next message;
  - through the router: beside receipts on `/receipt-conversations`, Done by `/seen`, AP.Purchasing
    opening the order in its own company and not another's, and AP.Validate reading but not
    writing.
- Related suites pass: order sharing, receipt sharing and messages, receipt timeline, portal,
  purchase orders, order checking, orders in, supplier messages.
- **vf-portal** `network.test.ts`: a reply about an order goes to the order.
- **vf-ui browser:**
  - `purchase-orders.test.ts`: the conversation on the order with the question waiting, no Ask
    supplier without the permission, and none when not shared;
  - `receipt-conversations.test.ts`: an order in Conversations, and Done at the order's address.
- **vf-ui worker** proxy test: the two paths.
- **vf-licence** string coverage.
- The full vf-ui browser suite passes except the known `typography.test.ts` gap and
  `signin.test.ts`'s *marks body as working*, which fails the same way without this change.
- **Screenshot:** an order with Query raised and its conversation, in the network.

## To deploy

Migrations: vf-app `0169_order_supplier_messages.sql`, vf-licence
`0350_order_conversation_strings.sql`. Deploy vf-app, vf-licence, vf-ui and vf-portal.
