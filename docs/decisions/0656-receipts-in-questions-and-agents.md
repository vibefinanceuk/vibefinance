# 0656: Goods receipts in questions and agents

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-licence
migration `0298`** (strings) and no vf-app migration. Deploy
vf-licence, then vf-app and vf-ui.

## What was asked

This is slice 6, the last, of the Warehouse Receipts proposal (Goods
Receipts level 3, agreed with Dan 6 October 2026):

| Addition | What it gives |
| --- | --- |
| Receipts dataset | Receipt lines with order, supplier, item, movement, quantity, value, reason, date, status and who recorded them; AP.Receive or AP.Validate, by the order's unit. |
| Purchase orders dataset | Gains receipt state and GRNI amount. |
| Report: waiting on receipt | Invoices stopped by Awaiting receipt for more than N days. |
| Report: received, not invoiced | GRNI lines older than N days, by supplier. |
| Report: credit still owed | Returns after invoicing with no credit note yet. |

The flag for a line waiting more than 7 days for its PO (question 5)
was promised a report here in 0654.

## What was built

### The Receipts dataset (`agent-query.ts`)

**`receipts`** has one row per goods receipt line. It joins the
receipt, the order and order line (left joins, since a line can wait
for an order not loaded), and the return reason.

| Field | Kind | |
| --- | --- | --- |
| `receipt` | text | the receipt or return number |
| `receiptDate`, `daysSinceReceipt` | date, days | |
| `order`, `supplier`, `item` | text | the order's supplier and line item |
| `movement` | enum | received or returned |
| `value`, `currency` | money, text | quantity at the order line's unit price, as GRNI values it (0650) |
| `receiptStatus` | enum | registered, pending, rejected or cancelled |
| `lineStatus` | enum | counted, waiting (for its order), needs_attention (at Matching) or rejected |
| `daysWaiting` | days | empty unless waiting |
| `returnReason`, `deliveryNote` | text | |
| `recordedBy` | text | the person, or the source it arrived by (0655) |

- It is scoped by the order's organisation. A line whose order isn't
  loaded has none, and is everyone's, as elsewhere.
- **"New since the last run"** goes by when the line was recorded.
- **Totals** are by value, per currency.

**AP.Validate, not "AP.Receive or AP.Validate".** A dataset has one
permission. That permission decides who may ask, which organisations
are offered, and who may receive the agent's copies. Giving one dataset
two would have changed all three. Purchase orders is already
AP.Validate, so receipts go with it.

### Purchase orders gain their receipt state

`receipt` is a new enum on each line: not, partially, fully or
over-received.

- It is worked out as Goods Receipts does (0645/0646): net received on
  registered receipts, from counted lines only, against the ordered
  quantity.
- It allows the supplier's quantity tolerance, else the organisation's.

**GRNI amount is not a field.** Not invoiced needs matching's invoice
consumption, which is worked out in code rather than SQL (0650). It is
the **received, not invoiced** report instead, below.

### Three ready-made reports (`agents.ts`)

All three are AP.Analysis, by the organisations chosen.

| Report | Shows | Option |
| --- | --- | --- |
| **`waiting_on_receipt`** | Invoices held at a stage by an open task a receipt rule raised (a rule that reads a receipt fact, 0648: Awaiting receipt, Credit expected), for at least the days chosen. One row per invoice, by its oldest such task. | `olderThanDays` 1–365, default 3 |
| **`received_not_invoiced`** | GRNI as at today (0650): the lines whose oldest goods not invoiced are older than the days chosen, by supplier, at the order's price. | `olderThanDays` 0–365, default 30 |
| **`credit_still_owed`** | Order lines with a credit expected (0647): goods returned after being invoiced, more invoiced than kept beyond tolerance. Valued at the order's price, with the last return's date. | none |

- **Rows:** each row has a key, so a scheduled run tells each person
  only what is new to them.
- **Columns:** waiting on receipt gives invoice, supplier, PO, stage,
  days waiting and total. The other two give supplier, PO, line, item,
  quantity, date, days and value.
- **Totals** are per currency.

Each is in the AI planner's closed list (`REPORT_WORDS`). It also has
its email and CSV words, in English and German, as does every new
column and value.

### Ready-made agents (vf-ui `agents.js`)

- **Invoices waiting on goods** (`waiting_on_receipt`): every working
  day at 9am, three days or more.
- **Goods received, not invoiced, over 30 days**
  (`received_not_invoiced`): every Monday at 8am.
- **Credit still owed** (`credit_still_owed`): every Monday at 8am.
- **Receipt lines waiting for their order**, a ready-made question
  (0638) on Receipts: every working day at 9am, lines whose status is
  waiting with days waiting over 7. These are the flagged lines from
  0654, by receipt, order, supplier, item, days and who recorded them.

Each is offered only where the person may use its report or dataset.

### Words (vf-licence `0298`)

Forty-five keys, in English and German:

- the dataset;
- its fields and values;
- the three reports and their hints;
- the four ready-made agents.

## Verification

- **`vf-app`** `agents-receipts.test.ts`, 7 tests:
  - **The Receipts dataset:**
    - every line with its receipt, order, supplier, item, movement,
      value, status, line status, return reason and who recorded it;
    - a line waiting for an order not loaded, with no supplier or
      value;
    - the ready-made question finds WH-9, 15 days waiting;
    - received value added up by supplier, per currency.
  - **Purchase orders:** each line partially or not received.
  - **Waiting on receipt:**
    - the default is 3 days;
    - INV-B, 5 days at Matching, is found;
    - it is gone at 6 days, and gone again when the task is another
      rule's.
  - **Received, not invoiced:**
    - the default is 30 days;
    - PO-301, 20 boxes, 46 days old, is valued at £100, with its total;
    - it is gone at 60 days.
  - **Credit still owed:** PO-300, 5 returned after 40 invoiced, valued
    at £50, last returned 25 days ago.
- `agents-query-datasets.test.ts` now lists `receipts` among Dan's
  datasets, after Purchase orders. All 16 agent test files pass, 121
  tests.
- **`vf-ui`** browser `agents.test.ts` gains 2 tests:
  - the four ready-made receipt agents are offered where their reports
    and dataset are, and the waiting-lines question fills the query on
    Receipts;
  - they are left out where they aren't the person's.
  The fixture can now add reports and datasets.
- **Full runs**:
  - vf-app 3673, of which 3671 pass (the two known failures);
  - vf-ui browser 1595, of which 1594 pass (the known
    `typography.test.ts` 10px gap);
  - vf-ui worker 111 of 111;
  - vf-licence 362 of 362;
  - migrations replay to vf-licence 298.
