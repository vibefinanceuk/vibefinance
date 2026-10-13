# 0759: Orders to suppliers

**Status: built.**

- vf-app:
  - migration 0171;
  - `orders-out.ts` (new);
  - `purchase-order-route.ts`, `purchase-orders-in.ts`, `destination-delivery.ts`,
    `connector-library-route.ts`, `load-suppliers.ts`, `supplier-audit.ts`, `order-timeline.ts`,
    `resend-client.ts`, `index.ts`.
- shared:
  - `ingestion/ubl-order-writer.ts` (new);
  - `ubl-order-parser.ts`, `connectors/library.ts`.
- vf-ui:
  - `orders-out.js` (new);
  - `process-routes.js`, `route-library.js`, `purchase-orders.js`, `order-timeline.js`,
    `timeline-entry.js`, `suppliers.js`, `app.css` (copied to vf-portal);
  - the proxy: `send-to-supplier` and `orders-out`.
- vf-licence: strings migration 0354.

## What was asked

Slice 4 of purchase orders: emailing orders out, with an *Orders to suppliers* destination. Dan,
13 October 2026, discussing it:

- **The address:** agreed a fixed order of preference for who an order goes to, *"so it's
  predictable"*.
- **The PDF:** agreed pdf-lib, inside our own code, for the PDF. That is slice 4b.
- **The Document tab:** a Document tab in VibeFinance and the supplier network, with downloads as
  PDF, UBL XML and CSV. That is slice 4b.
- **Confirming receipt:** a link in the email for the supplier to confirm receipt. That is slice
  4c, and it confirms on a button, never on the link alone.
- **When to send:** both automatically on release and by hand, chosen per destination.

This is 4a: sending.

## What changed

### The Destination

*Orders to suppliers* (`orders-email-out`) is a standard Destination route and connector:
- from the process, as UBL, by email;
- for purchase order processes only, and a purchase order process takes no other destination;
- one per process.

Process routes now offers *Add destination* on the Purchase Orders process, and the Route library
offers it for purchase order processes only.

- **Created paused.** *Start sending* starts it. Only what is released after that is sent on
  release; anything earlier can be sent by hand from the order.
- **Pause, resume, rename, retire and delete** work as for HTTPS out.
- **Its panel** says who orders go to, in order, and lists what it sent with the status and
  address of each. It also holds its settings:
  - **Send on release:** on by default. Unticked, sending is by hand only.
  - **Copy the order's buyer:** on.
  - **Attach the order as UBL:** on.
  - **Reply-to:** a Purchasing mailbox. Left empty, replies go to the buyer.
- **Business units:** it sends only for the companies set, as other Destinations do (0587).

### Who an order goes to

In a fixed order:

1. **The address the order itself gives.**
   - UBL's seller contact (`SellerSupplierParty/Party/Contact/ElectronicMail`), now read by the
     order parser;
   - our order CSV's new *Supplier email* column;
   - or the JSON order's seller contact.

   It is kept on the order (`purchase_orders.supplier_email`).
2. **The supplier's orders address** (`suppliers.orders_email`).
   - New on the supplier record, apart from its general email: suppliers often have orders@ and
     accounts@.
   - It may hold several addresses, separated by commas.
   - It can be edited on the supplier, and loaded by a supplier file's *orders email* column. A
     file without that column leaves it as it is.
3. **The supplier's general email** (0219).
4. **Otherwise nothing is sent.** The order's Timeline says there was no address, and Purchasing
   can give one and send it by hand.

The supplier is found by 0756's rule.

**Suppliers whose orders your own system sends.** Some suppliers already get their orders from
the customer's procurement system. For those, *Send orders by email* can be unticked on the
supplier (`send_orders`). It is VibeFinance's own setting: a supplier load leaves it as set.
These suppliers are not sent their orders on release, and the Timeline says why. Sending by hand
still sends.

### The email

The email is written in the supplier's language: German for DE, AT, CH or LI, English otherwise.

- **Subject:** *Purchase order PO-7 from Acme UK Ltd*, *Change to purchase order …*, or
  *Cancellation of purchase order …*.
- **Body:**
  - a short HTML and text body with the order's facts and lines;
  - a cancellation asks them not to deliver or invoice, and its note travels in the UBL.
- **Reply-To and Cc:**
  - replies go to the order's buyer, or the Destination's mailbox;
  - the buyer is copied where the setting says.
- **Attachment:** the order as Peppol BIS Order Only 3 UBL. A new writer
  (`shared/ingestion/ubl-order-writer.ts`) produces it from the order as it stands. It includes:
  - the company's legal entity: name, VAT number, Peppol endpoint and address;
  - the supplier as the customer keeps it.

  What the writer produces reads back through the order parser as the same order.

### When it sends

- **On release:**
  - on the five-minute cron;
  - straight after a release by hand from Checking;
  - each release at most once (a unique index on the Destination and release).
- **By hand:** *Send to supplier* on the order's page, for AP.Purchasing or Admin.Configure.
  - It shows who it would go to and which address it found, or that there is none.
  - It warns where your own system sends the supplier's orders.
  - It takes another address instead, and sends the order as it stands now.

### What is kept

Every send is a row in `purchase_order_sends`: who, how, which version and which address. The
order page shows the latest above its details. A sent one is also:

- **an outbound route message** in the Route monitor, with the email and the UBL as its parts;
- **listed on the order's Attachments;**
- **on the order's Timeline:** *Sent to supplier*, *Send failed* or *Not sent*. Underneath it says:
  - which address it went to;
  - whether it went on release or by hand;
  - and whether the UBL was attached.

A refused send says why, and can be sent again.

### Words (vf-licence 0354)

68 keys, in English and German.

## Tests

- **vf-app** `orders-out.test.ts`, 10 tests:
  - the order of preference, and the order's address read from a UBL order;
  - the Destination:
    - only on a purchase order process, which takes no other;
    - one per process;
    - paused, and sending nothing, until started;
    - its settings, with the reply-to checked;
  - sent on release:
    - once, to the supplier's orders addresses, with the buyer copied and replies to them;
    - the lines in the body;
    - the UBL attached, which reads back as the order;
    - on the order's Timeline, Attachments and Route monitor;
  - a change and a cancellation, in German, with the cancellation's note in the UBL;
  - a supplier whose own system sends its orders: not sent on release, but sent by hand;
  - no address: waits, saying so, then goes to an address given by hand, and refuses a bad one;
  - a refused send is recorded with why, and sent again;
  - by hand with no Destination is refused;
  - through the router: who reads orders sees it, who works them sends, and the settings are
    Admin.Configure's.
- **shared** `ubl-order-writer.test.ts`: the writer's output reads back as the order, and leaves
  out what is unknown.
- **vf-ui browser** `orders-out.test.ts`:
  - the panel on Process routes, saving its settings;
  - *Send to supplier* with who and why;
  - another address;
  - no address;
  - not offered to whoever only reads orders;
  - the Timeline's words.
- **vf-licence** string coverage.
- **vf-ui worker** proxy test: the three paths.
- **Existing tests updated:**
  - the seeded routes list `orders-email-out`;
  - Purchase Orders' Process routes now offers that destination;
  - saving a supplier's project-only tick sends its orders tick beside it.
- **Related suites pass:**
  - vf-app: orders, receipts, PO matching, suppliers, routes, destinations, connectors, processes,
    credit notes, network, portal, agents, Documents, GRNI and tasks (116 files, 2012 tests);
  - the shared package, except its known token-date and table-classification tests, which fail
    the same way without this change;
  - the full vf-ui browser suite, except the known `typography.test.ts` gap.
- **Screenshots:** *Send to supplier* on an order, and the Destination's panel.

## To deploy

Migrations: vf-app `0171_orders_to_suppliers.sql`, vf-licence
`0354_orders_to_suppliers_strings.sql`. Deploy vf-app, vf-licence, vf-ui and vf-portal (the shared
stylesheet).

**Then:**

1. In Process routes, on the Purchase Orders process, add the *Orders to suppliers* destination.
2. Set its reply-to address if you want one.
3. Press *Start sending*.

Emails go from the deployment's Resend sending address, as other emails do.
