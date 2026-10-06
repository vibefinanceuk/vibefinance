# 0654: Receipt lines waiting for their purchase order

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-app migration
`0143`** and **vf-licence migration `0296`** (strings). Apply both, then
deploy vf-licence, vf-app and vf-ui.

## What was asked

This is slice 4 of the Warehouse Receipts proposal (Goods Receipts level
3), agreed with Dan 6 October 2026: "A receipt whose PO is not loaded
waits in Matching and matches itself when the PO arrives, the way
invoices are re-checked when goods do." The agreed answers that apply:

- **Question 4:** register matched lines while one waits (a split).
  Goods physically in should count; the waiting line follows when its PO
  arrives.
- **Question 5:** no limit on how long a line may wait, but it is shown
  after 7 days.

## What was built

### vf-app migration `0143`

- `goods_receipt_lines.waiting_since`: when a line started waiting. It
  has a partial index by order, for the check when an order is loaded.
- `goods_receipts.register_partial`: Register was asked for while lines
  wait.

**A waiting line never counts**, even on a registered receipt:
`waiting_since IS NULL` joins `line_status = 'active'` and
`status = 'registered'` everywhere receipts are added up:

- `heldByLine`;
- `receiptStateJoin` and the credit-expected count;
- the receipt facts for matching;
- GRNI.

The orders a registered receipt touches leave waiting lines out too.

### Waiting, not needing attention

`Checker.checkLenient` now tells two cases apart:

- **an order not loaded at all** (`order_not_loaded`): the line waits;
- **an order outside the sender's units** (`order_not_found`, read as
  not there, 0375): a person must fix it, since loading won't change
  it.

`checkReceiptLines` now reports **attention** (to fix or reject) and
**waiting** separately, with **matched** and **released**:

- **On a pending receipt** every line is checked. A line waiting for its
  order keeps `waiting_since` from when it started, and a line that no
  longer waits loses it.
- **On a registered receipt** only its held-back lines are checked; the
  rest already count. A held-back line that now matches stops waiting
  and counts (`released`). One that still doesn't stays held back,
  whatever the reason now is.

**Matching's check** stops a receipt with any line to fix or waiting,
with its one task (0652). The exception is Register asked for while
lines wait: then the receipt goes through with those lines held back.

### Register while lines wait

`POST /goods-receipts/:id/register`:

- Lines needing attention still refuse.
- With **no line matched yet** it refuses with `all_waiting`: nothing to
  register.
- With matched lines and some waiting, it marks `register_partial` and
  registers. The matched lines count and the waiting lines stay on the
  receipt, held back.

The waiting lines are **not split into a new receipt**. That keeps
"loading the same file twice changes nothing": the receipt number and
line still find them.

### Loading the purchase order

`releaseWaitingReceipts` runs after `POST /purchase-orders` (XML) and
`/purchase-orders/csv-load`. The CSV result now names the loaded
orders (`orderNumbers`). For every receipt with a line waiting on one
of those orders:

- **Pending at Matching:** every line is checked again. If nothing is
  left to fix or wait for, its task **closes itself**: cancelled, ended
  by whoever loaded the order, `end_reason` `po:<order>`. The receipt
  then goes on and is registered.
- **Registered with lines held back:** each line that now matches
  counts.

Invoices waiting on those goods are checked again (0648). The PO load's
response gains `waitingReceipts`:

- receipts registered;
- lines now counted;
- receipts still waiting or needing attention;
- invoice tasks closed.

### Working a held-back line

`POST /goods-receipts/:id/lines/:n` also works on a **held-back line of a
registered receipt**: re-pointed at another order line, or rejected. A
re-pointed line that now matches counts, and invoices waiting on it are
checked again (the route now runs the re-check). A line already counted
can't be changed this way (`receipt_registered`).

### The screens (vf-ui)

- **Goods Receipts list:**
  - a **Lines waiting for a PO: n · days: d** pill, red after 7 days;
  - a **Waiting for a PO** filter.
  The list returns `waitingLines` and `waitingSince` (the oldest).
- **The pop-out:**
  - A waiting line shows **Waiting for its PO · days: d**, red after 7
    days, with the fix row: re-point or reject.
  - A registered receipt with lines held back says so, shows the Check
    column with **Counted** for lines that count, and offers the fix
    only on held-back lines.
  - Register refused with every line waiting is said in words.
- **Purchase Orders:** after a load, a line says what the load did for
  receipts waiting on those orders: registered, lines now counted,
  still waiting. It is shown as a warning when any still wait, along
  with the invoice tasks it closed.
- **Create's preview** names a line waiting for its order as such.

### Words (vf-licence `0296`)

Nine keys, in English and German.

## Not in this decision

The "waiting more than 7 days" **report** belongs with the receipts
reports in slice 6. Here the flag shows on the list and the pop-out.

## Verification

- **`vf-app`** `warehouse-receipts.test.ts` gains 4 tests (22 in all):
  - **Two kinds of missing order:** an order not loaded waits, with
    `waiting_since`; one outside the sender's units needs attention
    instead.
  - **Stopping and splitting:**
    - a receipt that only waits stops at Matching, and Register refuses
      with `all_waiting`;
    - a receipt with a matched and a waiting line registers with
      `register_partial`;
    - only the matched line counts;
    - both show under the Waiting filter, with their waiting counts.
  - **Loading the order through the router:**
    - the receipt that only waited is registered, and its task is
      cancelled by the loader with `po:PO-800`;
    - the held-back line counts;
    - the response says registered 1, lines now counted 1;
    - no lines are left waiting.
  - **The order loads without that line:**
    - the held-back line stays held with the new reason;
    - a counted line can't be re-pointed;
    - re-pointing the held-back line makes it count, and returns the
      order for the re-check.
  - A 0652 test now sees an unloaded order as waiting, not needing
    attention.
- The related suites pass: goods receipts, re-check, receipt facts,
  GRNI, purchase orders, task list and workflow engine, 266 of 266.
- **`vf-ui`** browser:
  - `goods-receipts.test.ts` gains 2 tests:
    - the waiting pill flagged at 9 days, and the filter;
    - a registered receipt with a line held back: the note, Counted
      against waiting, the fix only on the held-back line, and no
      Register;
  - `purchase-orders.test.ts` gains 1 test: the load's line about
    waiting receipts.
- **Screenshots** of a registered receipt with a line held back for 11
  days, in Day and Night.
- **Full runs**:
  - vf-app 3660, of which 3658 pass (the two known failures);
  - vf-ui browser 1591, of which 1590 pass (the known
    `typography.test.ts` 10px gap);
  - vf-ui worker 111 of 111;
  - vf-licence 362 of 362;
  - migrations replay to vf-app 143 and vf-licence 296.
