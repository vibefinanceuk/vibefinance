# 0652: Matching's check, the AP Receiving task, and fixing a receipt's lines

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-app migration
`0142`** and **vf-licence migration `0294`** (strings). Apply both, then
deploy vf-licence, vf-app and vf-ui.

## What was asked

Slice 3 of the Warehouse Receipts proposal (Goods Receipts level 3,
agreed with Dan 6 October 2026) is:

- the built-in Matching check;
- the task for AP Receiving;
- the receipt pop-out, to fix or reject lines;
- Create → Goods receipts.

It is built in two parts. This is the first: everything but Create,
which follows as its own decision (Create gains Goods receipts, with
Upload receipts previewed like Batch upload, and Key a receipt / Key a
return).

The agreed answers that apply:

- **one task per receipt**, listing every line that needs attention;
- **over-receipt stays a warning**, never a task;
- **an AP Receiving team**, offered when the process is set up; its task
  needs AP.Receive;
- **registering matched lines while one waits** (a split) belongs with
  waiting for the PO, slice 4. Here a line whose order is not found
  needs fixing or rejecting.

## What was built

### vf-app migration `0142`

- **`process_stages.builtin_check`**, set to `receipt_matching` on the
  Warehouse Receipts Matching stage. A stage can carry a check of its
  own, not NLP rules: the rule vocabulary is shaped around invoices.
- **`goods_receipt_lines`** gains these columns:
  - `check_reason`: what Matching last found, NULL when the line
    matched;
  - `line_status`: active or rejected;
  - `reject_reason`.
- **Where the process was already set up by 0651:**
  - Matching gains AP.Receive;
  - the **AP Receiving** team is made in the AP team's unit (else the
    top unit), with everyone who holds AP.Receive as a member.

**A rejected line never counts.** `line_status = 'active'` joins
`status = 'registered'` everywhere receipts are added up:

- `heldByLine`;
- `receiptStateJoin` and the credit-expected count;
- the receipt facts for matching;
- GRNI.

### Setting up (`warehouse-receipts.ts`)

Setting up now also:

- gives Matching AP.Receive and the `receipt_matching` check;
- makes the AP Receiving team (named in the person's language) with
  every AP.Receive holder.

The response says the team and its member count. The screen says
"Matching's tasks go to the AP Receiving team. Members: n."

### Matching's check

`checkReceiptLines` checks each line as the screen does, using
`Checker.checkLenient`:

- the lines are checked in order, in the scope of whoever sent the
  receipt;
- a line is kept with its reason rather than refused when its order,
  order line, unit or held quantity is wrong;
- what can't be stored at all is still refused: no order number, no
  line number, no quantity, or a movement or return reason that isn't
  one.

The reason is stored on each line.

`receiptMatchingGuard` is run by the engine at a stage marked
`receipt_matching`, for a goods receipt, in the automatic-stage branch:

- **Every line matched:** the receipt goes on to Complete and is
  registered.
- **Otherwise it stops at Matching with one task:**
  - owned by AP Receiving, or by the AP team if AP Receiving is
    missing;
  - needing AP.Receive;
  - with no rule.
  With neither team it still stops; the pop-out is where it is worked.

`onTaskCompleted` hands back a stage with a built-in check for a real
visit, as it does a rule-bearing one, so the check is never skipped by
a cascade.

The task has no `system_reason`: that column's values are a closed
list (0080). A task with no rule on a `receipt_matching` stage *is*
Matching's receipt task.

**What isn't covered:** a rule set placed on Matching takes the
rule-bearing path, and the built-in check does not run there. That
waits for a receipt vocabulary for rules.

### A CSV through the process

A receipt sent through the process now keeps a line whose order, order
line, unit or held quantity is wrong. The line is stored with its
reason, and Matching stops the receipt. What can't be stored is still
refused by row.

Without the process, loading is unchanged: such rows are refused.

### Working it

**Fixing a line** (`POST /goods-receipts/:id/lines/:n`):

- `{ orderNumber, orderLine }` points the line at another order line. A
  different order must be one in the person's units.
- `{ reject: true, reason }` rejects that line alone.
- Either way, every line is checked again and returned.
- It works only on a pending receipt, with AP.Receive.

**Register** (`POST /goods-receipts/:id/register`):

- Every line is checked again. Anything needing attention refuses
  (`lines_need_attention`, with the lines). If every line is rejected
  it refuses with `no_lines_left`: reject the receipt instead.
- Otherwise the open task is completed by this person, and the
  instance goes on: Matching passes, Complete is reached, and the
  receipt is registered.
- Invoices waiting on these goods are checked again (0648).
- A pending receipt with no instance is registered directly.

**The task can't be completed as an ordinary one.** `POST
/tasks/:id/complete` refuses it with 409 `register_receipt`, since
completing would move the receipt on without checking its lines again.
Claiming it is unchanged.

### Tasks

- The task list joins the goods receipt. Its Document number is the
  receipt number, and its supplier is the first order's supplier.
- Opening a goods receipt task (`tasks.js`) opens the receipt's pop-out
  over the list, not the invoice viewer. Closing it reloads the list.

### The pop-out (`goods-receipts.js`)

- A pending receipt's lines gain a **Check** column: Matched, the
  reason in words, or Rejected.
- Under each line needing attention there is a row with:
  - **Order** and **Order line**, with **Change**;
  - **Reject line**, which asks for a reason.
  The pop-out opens again, checked.
- **Register** is offered beside Reject receipt. A refusal is said in
  words.
- `openReceipt(id, { onDone })` is exported for Tasks.

### Words (vf-licence `0294`)

Twenty keys, in English and German.

## Verification

- **`vf-app`** `warehouse-receipts.test.ts` gains 5 tests (15 in all):
  - **Setting up:**
    - the AP Receiving team with the AP.Receive holder;
    - AP.Receive and the check on Matching.
  - **A CSV through the process:**
    - a bad order line and an unknown order are kept with their
      reasons, while a bad quantity is still refused;
    - that receipt stops at Matching with one task (AP Receiving,
      AP.Receive, no rule), shown in Sam's tasks as WH-1 from
      Northwind;
    - the good receipt registers;
    - only it counts.
  - **Working it:**
    - Register is refused while a line needs attention;
    - a line is pointed at another order line;
    - rejecting a line needs a reason;
    - Register then completes the task by Sam, completes the instance
      and registers the receipt;
    - the rejected line isn't counted and is shown rejected;
    - registering again is refused.
  - **Refusals:**
    - Register with every line rejected;
    - a fix to an order outside the person's units.
  - **Through the router:**
    - completing the task is refused with `register_receipt`;
    - a line fix and Register go through;
    - INV-A's *Awaiting receipt* task closes and its instance completes.
- The related suites pass: goods receipts, re-check, receipt facts,
  GRNI, task list, workflow engine, task route and dashboard, 309 of 309.
- **`vf-ui`** browser:
  - `goods-receipts.test.ts` gains 2 tests:
    - each line's check in words, Register refused in words, a line
      changed and the pop-out opened again;
    - a line rejected with its reason, then Register with the re-check
      said;
  - the set-up test now checks the team line;
  - `tasks.test.ts` gains 1 test: a goods receipt task opens the
    receipt's pop-out, not the viewer.
- **Screenshots** of the pop-out with lines needing attention, in Day and
  Night. These moved the fix controls from a cramped column onto a row
  under each line.
- **Full runs**:
  - vf-app 3653, of which 3651 pass (the two known failures);
  - vf-ui browser 1585, of which 1584 pass (the known
    `typography.test.ts` 10px gap). A fix-row selector in the new test
    failed on the first full run and was corrected; both files were run
    again, 108 of 108;
  - vf-ui worker 111 of 111;
  - vf-licence 362 of 362;
  - migrations replay to vf-app 142 and vf-licence 294.
