# 0749: Purchase orders arrive by Source Routes, through a Purchase Orders process

**Status: live.** vf-app (migration 0166, `purchase-orders-in.ts`, `purchase-order-route.ts`,
`inbound-email.ts`, `source-route.ts`, `https-in-route.ts`, `route-monitor-route.ts`,
`route-reprocess.ts`, `warehouse-receipts.ts`, `index.ts`), vf-ui (`purchase-orders.js`,
`process-routes.js`, `https-keys.js`, `route-monitor.js`), vf-licence (strings migration 0347).

**Supersedes 0081 in part**: an order "never enters a process instance" holds until a customer
sets the Purchase Orders process up (see SUPERSEDED.md).

## What was asked

Dan, 12 October 2026: *"It's likely that a customer might already have a procurement system in
place, external to this solution. I think it might be good to have a small process / workflow,
such as we created with the Warehouse Receipts flow"*, and *"Source Routes would permit a path
for purchase orders to be transmitted to the system"*. Slice 1 of five agreed:

1. the order document type, the source routes, and orders pending until released (this record);
2. the process's checks, tasks for a purchasing team, changes and cancellations;
3. orders shared in the supplier network;
4. Email out, and an "Orders to suppliers" destination (a customer's choice, off by default);
5. invoicing from the order in the network.

Asked along the way, *"Is there a PEPPOL BIS 3.0 PO format we can adhere to?"*: yes. **Peppol
BIS Order Only 3** (UBL Order) is the reference format. The reader built for 0081 already reads
it. **Peppol BIS Advanced Ordering 3.0** adds Order Change and Order Cancellation, which slice 2
will take.

## What changed

### Three standard routes (vf-app migration 0166)

| Route | Gateway | Use |
| --- | --- | --- |
| **Orders in** (`orders-in`) | HTTPS | A procurement system posts with its source's key. |
| **Orders by email** (`orders-email`) | Email | A mailbox the procurement system sends its export to. |
| **Orders upload** (`orders-file`) | File import | Purchase Orders' own load is one message of it. |

Each is live at version 1, with `semantic_model` `purchase_order`, translation
`purchase_order_v1`, delivery format `ubl` and delivery gateway `process`.

### Every way in reads into the same order

- **A Peppol BIS order** (UBL Order, `application/xml`), read as 0081 reads it.
- **JSON named after the BIS order's elements**: `id`, `issueDate`, `documentCurrencyCode`,
  `buyerCustomerParty.id`, `sellerSupplierParty.id`, `anticipatedMonetaryTotal`, and
  `orderLines` with `id`, `quantity`, `unitCode`, `price.priceAmount`, `item.name` and
  `item.sellersItemId`. A line's `id` defaults to its place in the list.
- **Our order CSV** (0370).

Each order is then held to the same rules a load always applied:

- every line has an item name or an identifier, and line numbers are unique (0081);
- its company is known by the buyer's VAT number (0374);
- its status column is recognised (0377).

The CSV loader was split to share them: `readOrdersCsv`, `admitOrder`, `orderLineProblem`.
Refusals keep the file's order. A load without the process behaves exactly as before.

### Pending until released

- An admitted order is **staged** in `purchase_order_intake`: the order as read, its company,
  its status column, the message it came by, who sent it (a person, or nobody for a key), and
  whether an order of that number was already in force (**a change**).
- Nothing matches, receipts, counts towards GRNI or shares against an order still staged.
  **A change waiting leaves the order in force untouched.**
- Each staged order gets its own instance of the **Purchase Orders process** (`purchase-orders`,
  subject `purchase_order`). It runs Intake → Checking → Complete.
- Reaching Complete **releases** the order: it is written to `purchase_orders` as a load always
  wrote it, replacing the order of its number, and the intake names it. Receipts waiting for
  it then go on (0654), whoever or whatever sent it.
- Checking has no checks of its own yet (slice 2). Today an order passes straight through,
  unless a rule at Checking stops it, in which case it waits there.

### Setting it up

- `POST /purchase-orders/process` (Admin.Configure) creates the process, its three stages and
  its upload source, with names in the person's language. Asking again changes nothing.
- `GET /purchase-orders/process` says whether it is set up.
- **Until it is set up, nothing changes**: Purchase Orders' load and `POST /purchase-orders`
  store at once, with no message.

### Receiving

- **HTTPS: `POST /v1/sources/:id/orders`**, with the source's key.
  - It takes XML, JSON or CSV. `X-Reference` names the message.
  - It answers 202 with what each order became: released, or waiting at a stage, and whether
    it was a change. It gives a `check` address to ask again, and answers 422 when nothing
    was taken.
  - Bodies it refuses before storing anything:
    - not JSON, or not orders (400);
    - another content type (415);
    - a source that does not take orders (404) or is retired (410).
  - An XML body that isn't an order is stored, and its message fails at its format.
- **Email**: a source on the Purchase Orders process reads its XML and CSV attachments as order
  files, at once, with no AI. Anything else attached is passed over and recorded as such. Its
  orders go through the process and are never captured as invoices. An email with no order
  file is bounced.
- **Upload**: once the process is set up, Purchase Orders' load (CSV) and `POST
  /purchase-orders` (a UBL order) are each one message of Orders upload, from the person and
  named by the file. Their answer keeps the load's own shape, and adds the message and the
  process's outcome.
- The message ends delivered, partial (some orders refused) or failed: at its format when
  nothing could be read, or at translation (`refused`) when every order was refused.

### Sources, keys and the Route monitor

- A purchase order process takes **HTTPS** sources (Orders in) and **email** sources (Orders by
  email). Anything else is refused with `orders_https_or_email`. It gets no ERP Destination.
- The keys listing gives the address `…/v1/sources/:id/orders` and `receives: "orders"`.
- Process routes:
  - shows **Moves purchase orders** with a note;
  - offers HTTPS and Email when adding a source;
  - shows no Business unit picker (an order names its own company);
  - its How to send shows a Peppol BIS order `curl` example.
- The Route monitor:
  - counts each message's orders and those waiting ("Purchase orders: 2 · waiting: 1");
  - lists each order in the message's detail as Released, or waiting at its stage, and says
    whether it was a change;
  - offers the orders' sources in its filter;
  - refuses Run again (`orders_resend`): an order sent again replaces the one of its number.

### The Purchase Orders screen

- Under Load:
  - before the process is set up, *orders loaded here count at once*, with **Set up Purchase
    Orders process** for Admin.Configure;
  - after, *go through Purchase Orders and count once released*.
- A load sends the file's name and says *Sent through Purchase Orders. Released: n. Waiting:
  n.*, with its Route monitor message.

### Words (vf-licence 0347)

24 keys, in English and German.

## Not in this

- Checking's own checks, the purchasing team's tasks, Reject, Peppol Order Change and
  Cancellation (slice 2).
- Orders by SFTP, once that gateway collects for a process other than invoices.
- Re-checking invoices waiting on a released order beyond the receipts it releases, unchanged
  from a load today.

## Tests

- vf-app `purchase-orders-in.test.ts`, 12 tests:
  - **The routes, the process and its sources:**
    - the three routes are live with the order model;
    - Intake, Checking and Complete, and the upload source;
    - setting it up again changes nothing;
    - HTTPS and email sources are allowed, SFTP is refused;
    - no ERP Destination;
    - the keys listing gives the orders address.
  - **Reading:**
    - BIS-named JSON maps field for field;
    - the line rules refuse;
    - XML, JSON and CSV are told apart.
  - **HTTPS:**
    - released and in force, with its company;
    - the intake names the order;
    - the message's route, sender and status are recorded;
    - asking again gives the same answer;
    - the monitor counts it and lists it;
    - a change replaces the order;
    - JSON partial and failed;
    - Run again is refused;
    - refusals: 401, 400, 415, `not_orders`, a non-order XML failing at its format, and an
      invoice process's source (404).
  - **Pending:**
    - a rule at Checking holds a change, and the order in force keeps its lines;
    - a new order is not in force while it waits;
    - the monitor counts it waiting.
  - **Email:**
    - an XML and a CSV attachment both released, and no invoice made;
    - an email with no order bounced, failed at its format.
  - **Upload:**
    - one message from Dan, named by the file, partial with its refusal;
    - a file with no order number column refused as before (400);
    - with the process retired, a load stores at once with no message;
    - a UBL order posted to Purchase Orders goes the same way.
- Changed expectations: vf-app `routes.test.ts` and `index.test.ts` count the three new routes.
- Related suites pass: purchase orders, receipts in, warehouse receipts, goods receipts, inbound
  email, AI allowance, email limits, HTTPS in, sources, source email, processes, connector
  library, upload, route monitor and index.
- vf-ui browser:
  - `routes.test.ts`: a purchase order process on Process routes, and the orders How to send;
  - `route-monitor.test.ts`: orders in a message;
  - `purchase-orders.test.ts`: the process line, the file name and what the process did, and
    the direct line without Admin.Configure.
  - The full suite passes except the known `typography.test.ts` 10px gap.
- vf-licence string coverage.

## To deploy

Migrations: vf-app `0166_purchase_orders_in.sql`, vf-licence `0347_purchase_orders_in_strings.sql`.
Deploy vf-app, vf-licence and vf-ui. Then, to use it, set the process up from Purchase Orders, and
add an Orders in or Orders by email source on Process routes.
