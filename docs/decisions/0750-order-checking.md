# 0750: Checking in the Purchase Orders process: its checks, the Purchasing team, changes and cancellations

**Status: built.**

- vf-app: migration 0167, `order-checking.ts` (new), `purchase-orders-in.ts`,
  `purchase-order-route.ts`, `workflow-engine.ts`, `task-list-route.ts`, `permissions.ts`,
  `index.ts`.
- shared: `ubl-order-parser.ts`.
- vf-ui: `purchase-order-intake.js` (new), `purchase-orders.js`, `tasks.js`, `access.js`,
  `route-monitor.js`, `app.css`, and the proxy.
- vf-portal: `app.css`, kept identical.
- vf-licence: strings migration 0348.

## What was asked

Slice 2 of the purchase orders proposal (0749). Dan, 12 October 2026: *"yes, please start"*,
after:

> Checking's own checks: the supplier is recognised and active, the lines have a quantity,
> unit and price, and the currency is known. An order for an unknown company would wait for a
> task instead of being refused outright. Tasks for a Purchasing team (with a new AP.Purchasing
> permission), so they can fix an order or reject it with a reason. Changes and cancellations,
> including Peppol Order Change and Order Cancellation. A change that would take a line below
> what's already been received or invoiced would stop for a task.

## What changed

### Checking's own check (`order_checking`)

Every order on its way in is looked at before it is released:

| Found | Code | Can be released anyway |
| --- | --- | --- |
| The company is not known (buyer VAT matches no legal entity) | `company_unknown` | No: set it |
| No supplier named | `supplier_missing` | Yes |
| The supplier is not on file (VAT however written, or ERP number) | `supplier_unknown` | Yes |
| The supplier is inactive | `supplier_inactive` | Yes |
| No currency | `currency_missing` | Yes |
| The currency is not an ISO 4217 code | `currency_unknown` | Yes |
| Lines with no quantity, unit or price | `line_incomplete` | Yes |
| A change ordering less than has been received (0646) | `below_received` | Yes |
| A change removing a line with goods received | `line_removed_received` | Yes |
| A cancellation of an order not in force | `nothing_to_cancel` | No: reject it |
| A cancellation where goods were received | `cancel_received` | Yes |
| A cancellation where invoices name the order | `cancel_invoiced` | Yes |

- **Nothing found: on it goes and is released**, as in 0749.
- **Something found: it stops at Checking with one task**, for the **Purchasing** team, needing
  **AP.Purchasing**. What was found is kept on the order (`purchase_order_intake.check_json`).
- **An unknown company now waits for a person rather than being refused**, when the order comes
  through the process. A load without the process still refuses it, as before. An
  unrecognised status column is still refused either way.
- Received is judged by registered receipts; invoiced by invoices whose PO is the order and
  that will be paid.

### AP.Purchasing and the Purchasing team

- **AP.Purchasing** is a new permission, granted to nobody by default. Access offers a
  ready-made **Purchasing** role holding AP.Purchasing and AP.TaskView, so its tasks are seen.
- **The Purchasing team** is made when the process is set up, or by migration 0167 where it
  already is (Dan's). It goes in the AP team's unit, else the top unit, with everyone holding
  AP.Purchasing. **Each time the check raises a task, everyone holding AP.Purchasing is added to
  it**, so someone given the permission later sees its tasks; nobody is taken out.
- Migration 0167 gives an existing Checking stage its check and AP.Purchasing.

### Working an order held at Checking

- **Its own page**, in the application's frame as a receipt's (0741), opened from its task in
  Tasks or from the waiting list on Purchase Orders. It shows:
  - where it waits, and what Checking found, in words, with the lines;
  - who has claimed it;
  - what it is (a new order, a change, a cancellation), its company, supplier, dates,
    currency, total, who sent it, and an Order Change's own id and sequence;
  - its lines, the flagged ones highlighted, and for a change what the order in force has now
    (*was 10 at 24*, *new line*, and lines no longer in it).
- **Claim first** (as 0657).
- **Once claimed, AP.Purchasing may:**
  - **set the company**, from the legal entities;
  - **set the supplier**, from a search by name, VAT or ERP number, written into the order as
    its VAT number (else ERP number). Each runs the check again.
  - **Release order.** Where something is still found, the page lists it and asks *Release
    anyway*; the server refuses without `anyway` (`order_has_problems`). It is refused
    outright while the company is unknown or there is nothing to cancel (`order_blocked`).
    Released anyway is recorded, with who.
  - **Reject order**, with a reason: the instance ends as rejected and the task is cancelled
    (`order_rejected`). It is never in force.
- **The task is done by Release or Reject, not Complete** (`release_order`, as a receipt's is by
  Register, 0652). A task a rule raised at Checking is completed as any other, and the order goes
  on.
- **Tasks** shows the order by its number and supplier, and search finds it by number.
- **Purchase Orders** lists the orders waiting in the process, above the orders in force: number,
  what it is, company, supplier, what was found, and who has it.
- Endpoints:
  - `GET /purchase-orders/intake?status=` and `GET /purchase-orders/intake/:id`, for
    AP.Purchasing, Admin.Configure or AP.Validate;
  - `POST /purchase-orders/intake/:id/fix|release|reject` and `GET …/suppliers?q=`, for
    AP.Purchasing.

### Changes and cancellations

- **What an order on its way in is** (`purchase_order_intake.kind`):
  - an **order**: new, or a whole order of a number in force, which replaces it as before;
  - a **change**: a Peppol Order Change, or the same number sent again;
  - a **cancellation**.
- **Peppol BIS Advanced Ordering 3.0**, read in `shared` beside the Order reader:
  - **Order Change** (`OrderChange`): the order it changes is `cac:OrderReference/cbc:ID`; its
    `cbc:ID` and `cbc:SequenceNumberID` are kept. **Applied to the order in force line by line**:
    a line with `cbc:LineStatusCode` 2 (Deleted) is removed; any other code adds it or replaces
    the line of its number, keeping what it does not say. Lines it does not carry stay as they
    are, so a sender of every line and a sender of only the changed lines come to the same
    order. Header values it gives replace the order's.
  - **Order Cancellation** (`OrderCancellation`): the order it cancels, and its
    `cbc:CancellationNote`, kept as the reason.
- **JSON and CSV** cancel with a status of **Cancelled** (also *Canceled*, *Cancel*), the
  reason in `cancellationNote` or `hold_reason`.
  - Loaded without the process, Cancelled closes the order, as Closed does. It was refused as
    unrecognised before.
  - The CSV format reference says so.
- **A change waits** while Checking holds it, and the order in force keeps its lines until it
  is released (0749).
- **A cancellation, released, closes the order in force** (0377), so nothing more is received
  or invoiced against it.
- The Route monitor and the HTTPS answer say *a cancellation of the order*.

### Words (vf-licence 0348)

91 keys, in English and German.

## Not in this

- Sharing orders with suppliers in the network (slice 3), Email out (slice 4), invoicing from an
  order (slice 5).
- Applying Order Changes in their sequence when they arrive out of order. Each is applied to the
  order in force when it arrives; its sequence number is kept and shown.
- An Order Response back to the buyer's system.

## Tests

- **shared** `ubl-order-parser.test.ts`, 3 new tests:
  - tells an Order, an Order Change and an Order Cancellation apart;
  - reads a change's reference, id, sequence and line status codes, and refuses one with no
    reference;
  - reads a cancellation's order, note and parties.
- **vf-app** `order-checking.test.ts`, 16 tests:
  - **Setting up:** the check and the permission on Checking, and the team with everyone
    holding AP.Purchasing; someone given it later joins when the next task is raised.
  - **What Checking finds:**
    - a whole order passes through;
    - an unknown supplier, no currency and incomplete lines are each found, with one task for
      Purchasing;
    - an inactive supplier (VAT written with a space) and an unknown currency are found;
    - Tasks shows the order by number and supplier, and Complete on its task is refused;
    - an unknown company waits instead of being refused: Release is refused unclaimed and
      blocked, and once the company is set it is released into that company, the task
      completed.
  - **Working one:**
    - only the claimer acts;
    - Release asks first, then releases anyway, recording who;
    - setting the supplier checks again;
    - Reject needs a reason, ends the instance, cancels the task, and refuses a later release;
    - the waiting list.
  - **Changes and cancellations:**
    - a change below received is held, and the order in force keeps its lines;
    - an Order Change is applied line by line;
    - applying a change keeps unsaid values, and with nothing in force takes the change less
      its deleted lines;
    - a cancellation closes the order, or waits where goods were received and then closes it;
    - a cancellation of nothing can only be rejected;
    - Cancelled by CSV through the process, and directly without it.
- **vf-app** `purchase-order-route.test.ts`: the unrecognised-status example is *pending* now,
  and *Cancelled* is among the aliases (closed).
- **vf-app** `purchase-orders-in.test.ts`, updated:
  - complete fixtures (a supplier on file, prices, currency);
  - an unknown company now waits at Checking rather than being refused, and an unrecognised
    status is what makes a message partial or failed.
- **vf-ui browser:**
  - `purchase-order-intake.test.ts`, 7 tests:
    - where it waits, what was found, flagged lines, and what is in force;
    - Claim;
    - setting the company and the supplier;
    - Release anyway only when asked;
    - Reject's refusal in the screen's words;
    - a blocked cancellation offers no Release;
    - someone without AP.Purchasing may only look.
  - `tasks.test.ts`: an order task opens its page.
  - `access.test.ts`: the ready-made Purchasing role.
  - `purchase-orders.test.ts`: the waiting list, and none while none wait.
  - The full suite passes except the known `typography.test.ts` 10px gap.
- **vf-ui worker** proxy test: the intake paths.
- **vf-licence** string coverage.
- **Screenshots:** an order change held at Checking, claimed, in Day and Night.

## To deploy

Migrations: vf-app `0167_order_checking.sql`, vf-licence `0348_order_checking_strings.sql`.
Deploy vf-app, vf-licence and vf-ui (and vf-portal, for the shared stylesheet). Then give
someone AP.Purchasing: Access → Roles → *Add the Purchasing role*, and give it to them. They join
the Purchasing team when Checking next raises a task.
