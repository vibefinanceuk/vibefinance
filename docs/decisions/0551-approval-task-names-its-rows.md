# 0551 — An approval task on a split line names its rows

**Status: built and tested locally, not yet pushed or deployed.** Delivered
with 0550 and 0552. Touches `vf-app`, `vf-ui` and `vf-licence`, and needs
**`vf-app` migration `0103`** and `vf-licence` migration `0204` (shared
with 0552).

## What was asked

0548 gave each approver one task per line, naming the rows only in its
reasoning. Asked whether to raise a task per row instead, the operator
chose **one task per approver, showing their rows**.

## What was decided

- `tasks.split_rows` (migration `0103`): the rows of a split line a task
  is for, such as "1,3". It is NULL for a task about a whole line or
  invoice.
  - In Cost-Object mode it holds the rows whose approver the task goes to
    (0548's resolution now records them: `ApprovalResolution.splitRows`).
  - Otherwise it holds the rows the rule matched (0550).
- The task list reports it as `splitRows`.
- **The viewer** shows a panel for such a task: "Your task covers line 1:
  8,400.00 of 12,000.00", then each row with its cost centre or project
  (named from the lists), share and amount.

## Verification

- `approval-hierarchy.test.ts`: the resolutions carry `splitRows`, merged
  when two rows reach one approver.
- `workflow-engine.test.ts`: the tasks record `split_rows` ("1" and "2").
- `task-list-route.test.ts`: `splitRows` reported.
- `viewer.test.ts` (2): the panel for such a task; none for a task about a
  whole line.
- With the previous files, the new tests **failed**; the "no panel" test
  passed, as it should.
