# 0550 — Line-scope rules test each row of a split line

**Status: built and tested locally, not yet pushed or deployed.** Delivered
with 0551 and 0552 in one git bundle. Touches `vf-app` and `shared`
(vocabulary); no migration of its own.

## What was asked

0548 left a known gap: a line-scope rule such as "if the cost centre is
Facilities" never fired for a split line, whose own cost centre is blank.
Asked how a row should be tested, the operator chose **the row's coding
and the row's amount**.

## What was decided

- At a line-scope stage, a split line is evaluated once per row. Each row
  is tested as though it were the line:
  - `BT-133`, `coding.project` and `coding.gl_code` are the row's;
  - `BT-131` is the row's share of the line's net amount;
  - everything else is the line's and the invoice's.

  So "cost centre is Facilities and net over 5,000" tests Facilities'
  share.
- A new fact, `coding.split_row`, gives the row being tested (from 1). It
  is absent on a line that is not split.
- **One action per line, not per row.** A rule matching several rows of
  one line raises its task once, for those rows (0551 records which).
  - The task's amount is what the matched rows come to.
  - At an approval-hierarchy stage in Cost-Object mode, only the matched
    rows are routed, each to its own approver (0548).
- A line that is not split is tested once, exactly as before.

## Not built / worth knowing

- `set_field` on a line-scope rule that matches several rows applies once
  per row.
- Each row's evaluation is recorded in the stage visit's steps under the
  line's number, so a rule that fires on two rows appears twice there.

## Verification

- `workflow-engine.test.ts` (3):
  - a rule on the cost centre matches rows 1 and 3 of a split line and
    raises one task naming both;
  - a rule on BT-131 over 5,000 matches only the 6,000.00 row, where the
    whole 12,000.00 line would have matched every row;
  - `coding.split_row` names a row.
- All three **failed** with the previous `workflow-engine.ts`.
