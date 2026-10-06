# 0653: Create → Goods receipts

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-licence
migration `0295`** (strings) and no vf-app migration. Deploy
vf-licence, then vf-app and vf-ui.

## What was asked

This is the rest of slice 3 of the Warehouse Receipts proposal (Goods
Receipts level 3). Dan suggested it: "We could use the same Create button
in the AP menu, to support Create GR also?" The proposal, agreed, said:

- a choice at the top of Create, **Invoices / Goods receipts**, shown to
  someone who holds both AP.Create and AP.Receive; someone with only one
  sees only theirs, and Create is in the menu for either;
- on the goods receipts side:
  - **Upload receipts (CSV)**, previewed like Batch upload and sent
    through the process;
  - **Key a receipt / Key a return**, today's form, which registers at
    once;
- the preview runs the same checks Matching will and **refuses
  nothing** that Matching can fix;
- **the Goods Receipts screen stays the register**, and its Load CSV,
  Record a receipt and Record a return become shortcuts into Create
  (question 6).

## What was built

### The preview (vf-app)

`POST /goods-receipts/csv-preview` needs AP.Receive.

- It runs the CSV load with `dryRun`. That is the same parsing and the
  same checks: lenient through the process when it is set up (0652),
  strict otherwise. Nothing is written.
- It returns the load's answer and the process (name, or none).

The load (`handleLoadGoodsReceiptsCsv`) now also returns **`receipts`**,
one entry per receipt in the file:

- its id, number and date;
- whether it was **on file already** (lines added to it);
- its orders and the lines that loaded;
- the lines kept for Matching, with why;
- the lines skipped as already loaded;
- the rows refused.

On a real load these ids are the stored receipts', so the result can be
matched to where each went in the process (`process.sent`).

### Create (vf-ui `create.js`)

- **Invoices / Goods receipts**, a two-way switch at the top, shown only
  to someone who holds both permissions.
  - Someone with only AP.Receive opens Create on Goods receipts.
  - Create is now in the menu for AP.Create **or** AP.Receive.
- **Tabs:** Upload receipts (CSV), Key a receipt, Key a return.
- **Upload receipts:**
  - **Send to** says where the receipts go: Warehouse Receipts, or
    "registered at once" when the process isn't set up.
  - **Download template** and **View accepted columns**, as on Goods
    Receipts.
  - Dropping or choosing a CSV previews it. Nothing is sent until
    **Send n receipts**.
- **The preview:**
  - counts: Ready, Need attention, Skipped, Refused;
  - a row per receipt with its date, orders, lines and what will happen.
    A receipt needing attention lists its lines and why; one with lines
    added to a receipt on file says so;
  - the refused rows, by row number;
  - a note that a receipt needing attention is still sent and waits at
    Matching. Only receipts with lines are sent.
- **This upload:** after sending, each receipt with its orders,
  **Registered** or **Waiting at Matching**, and **Open**, which opens
  the receipt's pop-out (0652) to work it there. It also shows lines
  skipped, refused rows, and invoice tasks the re-check closed.
- **Key a receipt / Key a return:** the form from Goods Receipts, drawn
  full width in the page (`openRecord(mode, { container, onSaved })`).
  Saved, it says what was recorded above the form, and a fresh form is
  ready for the next.

### Goods Receipts (`goods-receipts.js`)

- **Load receipts** keeps where a load goes, and setting the process up
  for Admin.Configure. Its button, **Upload receipts**, opens Create →
  Goods receipts.
- **Record a receipt** and **Record a return** open Create on Key a
  receipt and Key a return.
- `openCreateReceipts(tab)` (create.js) and `goToScreen` (tasks.js) do
  the opening.
- The CSV picker and its outcome panel move to Create.
- `openRecord` still works as a pop-out.

### Words (vf-licence `0295`)

Thirty-two keys, in English and German.

## Not in this decision

**One upload is one route message** (the proposal's Route monitor line)
comes with Receipts in, slice 5, which brings receipts into the Route
monitor.

## Verification

- **`vf-app`** `warehouse-receipts.test.ts` gains 3 tests (18 in all):
  - **The preview through the process:**
    - per receipt, a kept line with its reason, one on file skipped,
      one refused, with orders;
    - the bad row refused;
    - no `pendingIds`, and nothing written.
  - **The preview without the process:** the same rows refused as the
    screen refuses them.
  - **Through the router:**
    - the preview names the process and writes nothing;
    - the load then reports each receipt, matched to its process
      outcome (pending, registered).
- `goods-receipts.test.ts` still passes: 30 of 30 with the new file.
- **`vf-ui`** browser:
  - `goods-receipts.test.ts`:
    - the two recording tests open the form directly;
    - the screen's CSV test became **its Load and Record buttons open
      Create on the matching tab**;
    - the set-up test without Admin.Configure no longer loads;
    - 3 new tests on Create:
      - the switch for both permissions, and receipts only for AP.Receive;
      - a preview receipt by receipt, Send, and the result with Open;
      - keying a receipt in the page, with a fresh form after.
  - `create.test.ts`: all 12 pass. Create opens on Invoices unless the
    person may only receive.
- **Screenshots** in Day and Night: Create with the switch, the preview,
  the result, and Key a receipt. They led to:
  - the line number no longer being said twice;
  - dates kept on one line;
  - a goods receipts subtitle;
  - the keyed form drawn full width, with what was saved above it.
- **Full runs**:
  - vf-app 3656, of which 3653 pass: the two known failures, and
    `documents.test.ts` "finds by sender", a timing race in that test
    under load. The document and the email are each stamped "now" in
    separate statements, and the join needs the email no later than the
    document; a second boundary between them breaks it. Run alone it
    passed three times, 80 of 80. It is unrelated to this change.
  - vf-ui browser 1588, of which 1587 pass (the known
    `typography.test.ts` 10px gap);
  - vf-ui worker 111 of 111;
  - vf-licence 362 of 362;
  - migrations replay to vf-licence 295.
