# 0754: A purchase order's Timeline and Chat, and its Attachments

**Status: built.**

- vf-app:
  - migration 0170;
  - `order-history.ts` and `order-timeline.ts` (new);
  - `purchase-order-route.ts`, `purchase-orders-in.ts`, `order-messages.ts`, `index.ts`.
- vf-ui: `order-timeline.js` (new), `receipt-timeline.js`, `purchase-orders.js`, `attachments.js`,
  `timeline-entry.js`, `receipt-conversations.js`, `tasks.js`, and the proxy.
- vf-licence: strings migration 0352.

## What was asked

Dan, 13 October 2026, after 0753 put the order on a page of its own: *"In the same way that GR
supports attachments, and Timeline / Chat, do you think we should include that for Purchase
Orders as well?"* Agreed, and then: *"The Timeline / Chat should make note of PO changes,
modifications, and history"*.

## What changed

### The panel on the right

The order's page has three tabs, as a goods receipt's:

1. **Attachments**;
2. **Timeline / Chat**, which is shown first, with its count;
3. **Supplier**, the conversation with the supplier (0752).

The Supplier tab is always there. It says why when there is no conversation to have yet (0753).

### The Timeline: the order's history

Read at once from where each thing is kept, oldest first:

- **Each order, change and cancellation that came in** (0749/0750): by which route and from
  whom, or uploaded by whom; its change reference and note.
- **Checking:** the task Checking raised, and who claimed, released or reassigned it.
- **Released, and what the release changed.** Each change shows what differs, beneath the card:
  - header facts (date, currency, seller, buyer, requisition, order type, net amount, payable);
  - each line added, removed, or changed field by field, from what to what (item, description,
    seller's item, quantity, unit, price, amount);
  - the status, where a load set a different one;
  - the receipt warnings the change raised (0646).

  Released despite Checking's findings says so. A change that changed nothing says that.
- **Rejected,** by whom and why.
- **Hold, Release hold and Close** by hand, by whom, with the reason.
- **Goods received and returned** against it, a receipt at a time: how many, on which lines,
  and whether the receipt is still waiting or was cancelled.
- **Invoices and credit notes** that name the order, with their totals.
- **The supplier:** when they first opened it in the network, and each question, message and
  reply. The words stay on the Supplier tab.
- **The conversation here,** and people and teams added or removed.

**What a change did is kept when it happens.** An order is deleted and written again whenever a
load or a change replaces it (0081), so what it was is gone afterwards. `storeOrder` now compares
the order before and after, and writes what differs to `purchase_order_events`, naming the order
on its way in it came by.

**Orders from before this change.**

- Changes released before this decision are worked out from the version released before them,
  and the Timeline says so.
- An order loaded before any of this was kept shows only when it was loaded.

### The Chat

As a receipt's (0658):

- people and teams are added and removed, and the rows stay so the Timeline can say who was in
  it;
- whoever is added, and everyone else in the conversation on each post, is emailed, in their own
  language, with a link that opens the order (`/?order=`);
- it is in Conversations on Tasks until they read it: one row an order, merged with what the
  supplier wrote (0752), the latest of either quoted, tagged Added, Supplier or New.

**Who may do what:**

- AP.Validate or AP.Purchasing where the order is, and Admin.Configure, read and write.
- AP.Purchasing where the order is, and Admin.Configure, add and remove people.
- Anyone added who holds AP.Validate, AP.Purchasing, AP.Receive or Warehouse.Collaborate may open
  that order and write in it, so the warehouse can be brought in.
- Someone added through a team who holds none of those is not emailed. Someone named alone who
  holds none of them is refused, with the reason.

### Attachments

Every message an order, change or cancellation of its number came in by, a Source Route or
Purchase Orders' upload, oldest first, and the files each kept. They open by a signed link, as a
receipt's do (0659). An order keyed in, or loaded before files were kept, says so.

### Words (vf-licence 0352)

62 keys, in English and German:

- the Timeline's sentences;
- the labels of the new kinds of card;
- what a change did;
- who may be added;
- the Attachments tab's empty state.

## Tests

- **vf-app** `order-timeline.test.ts`, 12 tests:
  - a load and a change, with header facts and lines changed, added and removed;
  - Hold, Release hold and Close, by whom and why;
  - orders, changes and a rejected change on their way in, with Checking and what the release
    changed;
  - a change from before this decision, worked out from the one before it;
  - goods received and returned, and an invoice;
  - an order from before any of this;
  - who may open it, and a 404 otherwise;
  - adding the Warehouse team, refusing someone who could not open it, and removing;
  - posts emailed, and in Conversations until read;
  - the German email;
  - Attachments across two messages;
  - through the router, including a collaborator opening the order itself.
- Related suites pass: orders in, checking, sharing and messages; purchase order routes;
  receipts; PO matching; routes. In the full vf-app run, `stage-permissions`, `capture-pdf` and
  `key-fields` each have one test failing, and they fail the same way without this change. One
  `index.test.ts` test timed out under the full run's load and passes on its own.
- **vf-ui browser:**
  - `order-timeline.test.ts`: the three tabs, Timeline / Chat first, and Attachments loaded when
    first opened;
  - the history in words with each card's label;
  - what a change did, line by line;
  - posting at the order's address;
  - someone who could not open an order shown but not offered.
  - `purchase-orders.test.ts` and `receipt-timeline.test.ts` pass unchanged.
  - The full vf-ui browser suite passes except the known `typography.test.ts` gap.
- **vf-ui worker** proxy test: the seven paths.
- **vf-licence** string coverage.
- **Screenshot:** an order whose change was released, received and returned against, with the
  Warehouse in its conversation, in Day and Night.

## To deploy

Migrations: vf-app `0170_order_timeline.sql`, vf-licence `0352_order_timeline_strings.sql`.
Deploy vf-app, vf-licence, vf-ui and vf-portal (the shared stylesheet).
