# 0644: Goods receipts, slice 2 — the register

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app` and `vf-ui` (the proxy only). It needs **vf-app
migration `0140`**. No strings: this slice has no screen.

## What was asked

The second build step of the Goods Receipts proposal that Dan agreed
(0643): the receipts register itself, with the tables, the CSV load and
the routes. Dan's decisions from 0643 apply:

- every receipt names a PO line;
- a return reopens the line;
- more received than ordered is saved with a warning;
- AP.Validate sees receipts read-only, in its own units.

## What was built

### The tables (vf-app migration `0140`)

- **`goods_receipts`**:
  - the receipt number (unique), date, delivery note and note;
  - where it came from (`csv` or `screen`);
  - who recorded it and when;
  - who cancelled it, when and why.
- **`goods_receipt_lines`**:
  - the line within the receipt (unique per receipt);
  - the **order number and order line number**;
  - `received` or `returned`;
  - a quantity above nought;
  - a unit;
  - a goods return reason, which a return must have and a receipt must not;
  - a note.

**Lines point at the order number and line number, never the internal
PO line id.** A PO loaded again replaces its lines with new ids, and
that is how a change order arrives. **Nothing is deleted:** a receipt
entered by mistake is cancelled with a reason, and then counts for
nothing.

### The figures (`goods-receipts.ts`)

Everything is derived from the lines; nothing is stored. Each PO line
shows:

- **ordered**;
- **received** and **returned** (on receipts not cancelled);
- **net received**;
- **outstanding**;
- **invoiced** (two-way matching's own `loadPoConsumption`);
- a **state**: not received, partially received, fully received or
  over-received, within the supplier's quantity tolerance or else the
  organisation's;
- **credit expected**, when goods were returned and more was invoiced
  than was kept.

The order rolls its lines up. A line that receipts name but that the
order no longer has (after a change order) still shows, marked not on
the order.

### Recording

Lines are checked in order, with a running net received for each, so a
receipt and a return in the same file are judged in sequence. A line is
refused when:

- the order is not there, or is outside the person's AP.Receive units
  (this reads the same as not there, as for Purchase Orders, 0375);
- the order is closed;
- the order has no such line;
- the quantity is nought or not a number;
- the movement is neither received nor returned;
- the unit differs from the order line's;
- a return has no reason, or one that is not a goods return reason
  (matched by id or by its words);
- a return is more than is held on the line.

More received than outstanding is **saved, with a warning** naming the
line, what was ordered and what is now held.

- **On screen** (`POST /goods-receipts`): all or nothing. A refused
  line refuses the receipt, saying which line and why. A receipt number
  already used is refused.
- **By CSV** (`POST /goods-receipts/csv-load`): one row per receipt
  line. Column names are given once in `RECEIPT_CSV_FIELDS` (with
  alternative spellings such as *GR Number* and *PO Line*), and
  `GET /goods-receipts/csv-format` returns them.
  - **Loading the same file twice changes nothing**: a receipt number
    and line already loaded is skipped and counted.
  - A new line for a receipt already on file is added to it.
  - A refused row is reported with its row number and why; the rest
    still load.
- **Cancelling** (`POST /goods-receipts/:id/cancel`) needs a reason. It
  is refused if it would leave a line having returned more than it
  received; the screen will say to cancel the return first.

### Seeing

- `GET /goods-receipts`: the register, newest first. It is searched in
  the database (receipt number, delivery note, order number, item,
  supplier), filtered by kind (received, returned, cancelled), and
  paged. Each receipt carries the state its orders are in now.
- `GET /goods-receipts/status-counts`: orders by state, for the chart.
  It counts orders that are not closed and whose supplier is Receipting
  required or that have any receipt, plus how many expect a credit.
- `GET /goods-receipts/:id`: a receipt, its lines, and the figures for
  each order it names.
- `GET /goods-receipts/order/:orderNumber`: an order's figures and
  every receipt and return behind them, oldest first. The record form
  (slice 3) and the PO's receipt view (slice 4) use it.

**Who:**

- **AP.Receive** records, loads and cancels, for orders in its units.
- **AP.Receive or AP.Validate** sees receipts in the units where either
  is held. Orders with no unit are everyone's, as elsewhere.

vf-ui passes all the paths through.

## Not built

- The Goods Receipts screen and the record form (slice 3).
- The PO's receipt column and line view, and the change-order warnings
  in the PO load (slice 4).
- Stage 2: the receipt facts, the two standard rules, and the re-check.

## Verification

**`vf-app`** `goods-receipts.test.ts`, 10 tests:

- the line states and the tolerance;
- receiving and returning on screen, with each line's figures, the
  order's state, credit expected, and the order's history with the
  reason in words;
- over-receipt saved with a warning;
- every refusal, including another unit's order reading as not there,
  a receipt and a return in one receipt, a duplicate number, a
  non-existent date and a closed order;
- cancelling: blocked by a dependent return, needing a reason, done
  once, unseen from another unit, counting for nothing afterwards;
- the CSV: refusals by row, loading twice, and adding a line to an
  existing receipt;
- a missing column;
- a change order keeping receipts and showing the dropped line;
- the list, search, kind and scope, and the counts;
- through the router: AP.Validate looks, AP.Receive records.

The vf-ui worker test covers the eight paths.

**Full runs:** vf-app 3619, of which 3617 pass (the two known failures); vf-ui worker 111 of 111.

**Migrations:** replay of vf-app 140.
