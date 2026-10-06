# 0645: Goods receipts, slice 3 — the Goods Receipts screen

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-ui` and `vf-licence`. It needs **vf-licence migration
`0288`** (strings) and no vf-app change. Deploy vf-licence, then vf-ui.

## What was asked

This is the third build step of the Goods Receipts proposal Dan agreed
in 0643: the screen over the register (0644). He wanted it built *"like
the Purchase Orders UI, where Goods Receipts can be uploaded via a
CSV"*. Recording a receipt or a return on screen is for when the
invoicing tool is where a receipt gets captured. AP.Receive records;
AP.Validate only looks.

## What was built (vf-ui `goods-receipts.js`)

### Where it sits

**Goods Receipts** is last under Accounts payable, after Documents. It
is open to anyone holding AP.Receive or AP.Validate. It takes the second
colour as a fixed hue (as Create and Agents do, 0573 and 0622), so no
other screen changes colour. Its icon is a package with a tick.

### The screen, built as Purchase Orders is

- **Load receipts** (AP.Receive only): a CSV, the template, and the
  accepted columns with their meanings, all from
  `/goods-receipts/csv-format`. After a load the screen says:
  - how many lines were loaded and how many receipts are new;
  - how many lines were already loaded and left as they were;
  - each over-receipt, by row;
  - each refused row, with its reason in words.

  Someone with only AP.Validate sees a line saying that recording needs
  AP.Receive.
- **Orders by receipt**: a ring of not received, partially received,
  fully received and over-received orders, and how many orders expect a
  credit note.
- **Receipts and returns**: searched by receipt, order, delivery note,
  item or supplier, and filtered by kind (all, receipts, returns,
  cancelled), with paging. Each row shows:
  - the receipt, its date and its orders;
  - the supplier and the number of lines;
  - its kind as a pill, with the return reason;
  - **where each order stands now**, as a pill, plus *Credit expected*;
  - who recorded it.

  A cancelled receipt is greyed and marked.

### A receipt, in its pop-out

- The pop-out shows:
  - the date, delivery note, who recorded it and how, and the note;
  - its lines, each with its order and line, kind, quantity and
    reason;
  - **where each order stands now**: every line's ordered, received,
    returned, net and invoiced figures and its state, with *Credit
    expected n* on a line that has one. A line the order no longer has
    says so.
- **Cancel receipt** (AP.Receive) asks why, then cancels. A refusal
  comes back in words, such as *"Goods on this receipt were later
  returned. Cancel the return first."*

### Recording a receipt or a return

**Record a receipt** and **Record a return** open the same form.

- **Find the order.** Its lines appear with their figures.
- **For a receipt**, each line's outstanding quantity is filled in;
  change the ones that differ. A quantity that would take a line past
  what was ordered says so as it is typed. Dan decided it is saved, and
  the line then shows over-received.
- **For a return**, enter what went back on each line and choose a
  goods return reason. It applies to every line of that return.
- **Saving** sends only the lines with a quantity. The server's refusal
  is shown with its line (*"Line 1: More than is held on that
  line."*). Once saved, the screen says what was recorded and names any
  over-receipt.

The server decides every figure and every refusal; this screen only
says them.

### Words (vf-licence `0288`)

There are 119 keys, in English and German. They cover the screen, the
states and kinds, every refusal code from 0644, and the Help for the
screen.

## Not built (the next slices)

- The Purchase Orders screen's receipt column and line view, and the
  change-order warnings in the PO load (slice 4).
- Stage 2: the receipt facts, the Awaiting receipt and Credit expected
  standard rules, and the re-check on each receipt.

## Verification

**`vf-ui` browser `goods-receipts.test.ts`, 5 tests:**

- AP.Validate:
  - sees the menu item, the list with each order's state and credit
    expected, and the chart's credit line;
  - cannot record.
- A receipt's pop-out shows each line's figures, and a refused cancel
  is shown in words.
- Recording a receipt:
  - the outstanding quantity is filled in;
  - the over-receipt warning appears as the quantity is typed;
  - the body sent is checked;
  - the saved message and the warning are shown.
- Recording a return sends the reason, and a refusal is shown on its
  line.
- Loading a CSV reports what was loaded and refused, by row.

**Screenshots:** the list, a receipt and the record form were checked
in Day and Night. They caught a stray "null" printed where a pop-out
part was absent; absent parts are now left out.

**Full runs:**

- vf-ui browser: 1568, of which 1567 pass (the known `typography.test.ts`
  10px gap), with the same 331 unhandled errors;
- vf-ui worker: 111 of 111;
- vf-licence: 362 of 362;
- migrations replay to vf-licence 288.
