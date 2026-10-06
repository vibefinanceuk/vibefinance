# 0648: Three-way matching — the re-check when goods arrive

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-licence
migration `0291`** (strings) and no vf-app migration. Deploy
vf-licence, then vf-app and vf-ui.

## What was asked

This is the last part of Stage 2 of the Goods Receipts proposal (0643).
The proposal's words were: *"when a receipt or return is saved, find the
open invoices on that PO that are sitting in Matching, work out their
facts again, and re-run that stage's rules. If the rule no longer
fires, the task closes on its own."* Without it, every *Awaiting
receipt* task would be cleared by hand each time the warehouse loaded a
file. Dan chose the automatic re-check together with *override with a
reason*.

## What was built

### The re-check (vf-app `receipt-recheck.ts`)

It runs when any of these saves:

- a receipt or return on screen;
- a goods receipt CSV load;
- a cancellation.

Each response names the orders it touched. For each one,
`recheckReceiptTasks` looks at every invoice naming that order (BT-13)
whose instance is in progress. It takes every open task at that
invoice's **current stage** that a **receipt rule** raised: a rule whose
compiled conditions read `po.line_receipt_matched`,
`po.line_receipt_shortfall_pct` or `po.line_credit_expected`. Each such
task is checked against the invoice's live facts, using the rule
version that raised it. That check is the same one the Complete guard
already used (0487); `ruleStillFiresForTask` became a wrapper over
`checkTaskRule`, which can also say *cannot be told*.

- **The rule no longer fires:**
  - the task is closed as `cancelled`, as a task made moot is;
  - it is ended by the person who recorded the receipt, with
    `end_reason` set to `receipt:<number>`;
  - if it was the stage's last open task, the invoice moves on exactly
    as when a person completes the last one: `onTaskCompleted`, then
    the same follow-up visit at the next stage that has rules.
- **The rule still fires:** the task stays open, and the PO matching
  panel shows the new figures.
- **It cannot be told:** the task is left alone.

**Only receipt-rule tasks are affected.** A price, quantity or approval
task is never touched, and an invoice that still has one keeps waiting
at that stage.

**It only ever closes.** A return can make a *Credit expected* rule
fire where it did not. That task comes the next time the stage is
evaluated, as any rule's task does.

**A supplier no longer marked Receipting required** makes the receipt
facts absent, so the rule no longer fires and its task closes at the
next receipt. This is deliberate: nothing about receipts is holding
that invoice any more.

### What people see

- **The Timeline** (vf-app `activity-route.ts`, vf-ui `activity.js`)
  shows *"Standard rule: Awaiting receipt no longer applies after
  GR-1003, recorded by Sam. Its task closed by itself."*, with the Goods
  Receipts icon.
- **The Goods Receipts screen** shows, after a save, a load or a
  cancel, how many invoice tasks waiting on those goods have now
  closed, and how many still wait because more is invoiced than is in.
  The routes return this as `recheck: { closed, stillOpen }`.

### Words (vf-licence `0291`)

Three keys, in English and German.

## With this, the Goods Receipts proposal's Stages 1 and 2 are built

| Decision | What it built |
|---|---|
| 0643 | AP.Receive, the AP Receiving role, Receipting required, and goods return reasons |
| 0644 | The register |
| 0645 | The Goods Receipts screen |
| 0646 | Receipts on Purchase Orders, and change orders |
| 0647 | The receipt facts and the two standard rules |
| 0648 | The re-check |

The proposal's Level 3 is still to come:

- warehouse feeds by connector or Peppol Despatch Advice;
- goods received not invoiced for month-end accruals;
- receipts as a dataset for questions and agents.

## Verification

- **`vf-app`** `receipt-recheck.test.ts`, 6 tests:
  - which rules count as receipt rules;
  - **too little in:** the task stays open. **The rest arriving:** it
    closes, ended by the recorder, with the receipt number; the invoice
    completes past an AP Review stage with no rules; the Timeline item
    is checked;
  - a price task beside it is never touched, and the invoice waits for
    it;
  - **through the router:** a CSV load says it closed one task, and a
    cancel says it closed none;
  - a supplier no longer needing receipting: its task closes;
  - a cancel after the task closed closes nothing.

  The 0487 tests are unchanged (`stage-actions-route.test.ts`).
- **`vf-ui`** browser tests:
  - the Timeline line, with its icon (`viewer.test.ts`);
  - the screen saying what the re-check closed and what still waits
    (`goods-receipts.test.ts`).
- **Full runs**:
  - vf-app 3632, of which 3629 pass: the two known failures, and the
    same `index.test.ts` *supplier mappings* 5s timeout under load as in
    0646 and 0647;
  - vf-ui browser 1576, of which 1575 pass (the known
    `typography.test.ts` 10px gap), with the same 331 unhandled errors;
  - vf-ui worker 111 of 111;
  - vf-licence 362 of 362;
  - migrations replay to vf-licence 291.
