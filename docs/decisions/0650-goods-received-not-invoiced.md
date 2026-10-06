# 0650: Goods received not invoiced

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-licence
migration `0292`** (strings) and no vf-app migration. Deploy
vf-licence, then vf-app and vf-ui.

## What was asked

This is slice 1 of the Warehouse Receipts proposal (Goods Receipts
level 3, artifact *Warehouse Receipts*, 6 October 2026), which Dan
agreed with all six suggested answers. It asked for goods received not
invoiced, for month-end accruals:

- **a card on AP Analytics beside Accruals**, as at a chosen date, by
  supplier and organisation, aged by receipt date;
- **a CSV** to make the accrual journal from.

Two of the answers apply here:

- **every receipt counts**, not only those from suppliers marked
  Receipting required;
- **as at a date**: receipts by their receipt date, invoices by their
  issue date.

## What was built

### The figures (vf-app `grni-route.ts`)

Per purchase order line, as at the date:

- **Received**: receipt lines dated on or before the date, on receipts
  not cancelled by then. A receipt cancelled after month-end still
  counted at month-end, so month-end can be run again afterwards and
  agree.
- **Returned**: returns dated on or before the date.
- **Invoiced**: invoices against the line issued on or before the date,
  counted exactly as matching counts them. `loadPoConsumption` gains an
  optional as-at date; an invoice with no issue date counts, as it
  always has.
- **Not invoiced**: received less returned less invoiced, only where
  positive. The other way round is *Awaiting receipt* (0647).
- **Amount**: not invoiced at the PO line's unit price (price ÷ base
  quantity, else amount ÷ quantity), in the PO's currency. A line with
  no price is listed and counted as unpriced.
- **Ageing**: by the receipt date of the oldest goods not yet invoiced,
  taking what was invoiced and returned from the earliest receipts
  first. The age is the number of days to the as-at date.

These are then gathered:

- **per currency**: total, number of lines, over 60 days, and unpriced
  lines;
- **per supplier and currency**: its orders, and amounts for 0–30 days,
  31–60 days and over 60 days.

There is never one blended figure across currencies, as with Accruals
(0417).

**Who sees it:** AP.Analysis, by the order's unit and the chosen
organisation, as for Accruals.

### The route

`GET /grni?asAt=YYYY-MM-DD` (default today). `&format=csv` returns
`grni-<date>.csv`, one row per PO line, with these columns:

- `as_at`, `org`, `supplier`, `supplier_erp_id`;
- `order_number`, `order_line`, `item`;
- `received`, `returned`, `invoiced`, `not_invoiced`;
- `unit_price`, `amount`, `currency`;
- `oldest_receipt_date`, `days`.

A text cell starting `= + - @` is kept as text, so a spreadsheet does
not read it as a formula. A date that is not a date is refused. vf-ui
passes the path through.

### The card (vf-ui `grni.js`)

The card is third on Financial Performance, after Accruals and Spend
under management. It has:

- an **As at** date;
- **Download CSV** for the date shown;
- a tile per currency, with the total, its order lines, what is over 60
  days, and any unpriced lines;
- the suppliers table, aged.

Changing the date works the figures out again.

### Words (vf-licence `0292`)

Fifteen keys, in English and German.

## Verification

- **`vf-app`** `grni.test.ts`, 5 tests:
  - **The figures:** each line's amount, currency, oldest date and age,
    the currency totals and the supplier ageing. Invoiced quantity uses
    the oldest receipt first. The 10-per-base price is checked.
  - **As at the date:**
    - a later receipt, a later invoice and a later cancellation do not
      count;
    - the same month-end gives the same answer after a cancellation.
  - **Returns and limits:** returns are taken off, a fully invoiced
    line is left out, and nothing goes below nought.
  - **Scope, refusal and CSV:** scoped by unit and by the chosen
    organisation; a date that is not a date is refused; the CSV header
    and a row are checked.
  - **Through the router:** AP.Analysis only, as JSON and as CSV with
    its filename; a bad date gives 400.
- **`vf-ui`** browser:
  - `grni.test.ts`, 2 tests: the tiles and the supplier ageing;
    changing the date, and the CSV for it;
  - `ap-analytics.test.ts` now expects three cards on Financial
    Performance.
- **Screenshots**: the card was checked in Day and Night. That led to
  the date and Download CSV being put on one line, and to counts
  written as "Order lines: 23" rather than a plural.
- **Full runs**:
  - vf-app 3638, of which 3636 pass (the two known failures);
  - vf-ui browser 1578, of which 1577 pass (the known
    `typography.test.ts` 10px gap), with the same 331 unhandled errors;
  - vf-ui worker 111 of 111;
  - vf-licence 362 of 362;
  - migrations replay to vf-licence 292.
