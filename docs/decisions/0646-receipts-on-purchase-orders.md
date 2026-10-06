# 0646: Goods receipts, slice 4 — receipts on Purchase Orders, and change orders

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-licence
migration `0289`** (strings) and no vf-app migration. Deploy
vf-licence, then vf-app and vf-ui.

## What was asked

This is the fourth build step of the Goods Receipts proposal Dan agreed
in 0643: *"Purchase Orders gains a Receipt column with the order's
state, and a filter on it. Opening an order shows each line's figures
and the receipts and returns behind them."*

It also covers Dan's point 3. A return leaves part of the PO
un-receipted *"rectified by either another shipment and GR, or a Change
Order on the PO"*. A change order arrives as the PO loaded again (0370),
and the proposal said two cases are *"said in the load's result rather
than silently accepted"*.

## What was built

### Each order's receipt state, in SQL (vf-app `goods-receipts.ts`)

`receiptStateJoin` works out every order's receipt state in the
database. It uses the same rule as the register (0644):

- the line states use the supplier's quantity tolerance, or the
  organisation's;
- the order rolls its lines up as `orderState` does.

The work is done in the database so that a list can filter and page by
it. Only orders that receipting concerns have a state: those whose
supplier is Receipting required, or that have any receipt. Every other
order has none, rather than reading *Not received*. The chart's counts
on Goods Receipts now use it too; the tests show the numbers are
unchanged.

### On the Purchase Orders screen (vf-ui `purchase-orders.js`)

- **A Receipt column**: the order's state as a pill, or a dash.
- **A filter beside the search**: any receipt state, not received,
  partially, fully or over-received. `GET /purchase-orders?receipt=` is
  checked against the four states; anything else matches nothing.
- **In the order's pop-out**, a *Receipts and returns* section shows:
  - every line's ordered, received, returned, net and invoiced figures
    and its state, with *Credit expected n* where there is one (the
    same table as Goods Receipts);
  - every receipt and return behind them, oldest first, with the
    reason and who recorded it. A cancelled one is struck through.

  It reads `/goods-receipts/order/:n`. It is left out for an order that
  receipting does not concern, or that the person may not see there.

### Change orders meeting goods already received (vf-app `purchase-order-route.ts`)

When an order is loaded again, by CSV or as a Peppol order, `storeOrder`
compares the new lines with what has been received. Two cases are
reported as `receiptWarnings`:

- **`line_removed`**: a line with goods received is no longer on the
  order;
- **`below_received`**: a line now orders less than has been received,
  so it shows over-received.

The order still loads, because the ERP is the system of truth. The
receipts stay, keyed on the order and line number (0644). The load's
result on the Purchase Orders screen lists them under *Receipts to
check*.

### Words (vf-licence `0289`)

Nine keys, in English and German.

## Not built (Stage 2)

- The three receipt facts on each invoice line.
- The *Awaiting receipt* and *Credit expected* standard rules.
- The re-check when a receipt arrives.

## Verification

- **`vf-app`** `goods-receipts.test.ts`: two new tests.
  - **Receipt state on the PO list:**
    - one order partially received, the other with no state;
    - the filter, and a nonsense value matching nothing;
    - fully received within the supplier's 5% tolerance.
  - **Change-order warnings:**
    - by CSV, below received and line removed;
    - a first load warns of nothing;
    - by Peppol order, two lines removed.

  The existing tests (purchase orders, matching, the match panel) are
  unchanged, 150 of 150.
- **`vf-ui`** browser `purchase-orders.test.ts`: four new tests.
  - the column, the dash, and the filter reaching the request;
  - the pop-out's figures and its history in words;
  - the section left out when it cannot be read, with no stray "null";
  - the load's *Receipts to check*.
- **Screenshot**: the pop-out was checked with its receipt section.
- **Full runs**:
  - vf-app 3621, of which 3618 pass: the two known failures, and one
    test that timed out under load (*supplier mappings … need
    Admin.Configure*, 5s) and passes on its own;
  - vf-ui browser 1572, of which 1571 pass (the known
    `typography.test.ts` 10px gap), with the same 331 unhandled errors;
  - vf-ui worker 111 of 111;
  - vf-licence 362 of 362;
  - migrations replay to vf-licence 289.
