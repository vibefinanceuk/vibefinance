# 0548 — Split coding: one line's cost shared across cost centres and projects

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-app`
migration `0102` (apply before deploying `vf-app`) and `vf-licence`
migration `0203`**.

## What was asked

The last item from the coding discussion: split coding. The operator
approved a mock-up (the Coding pop-out with a line split three ways, the
"not yet balanced" state, and the line table's "Split · 3" chip) and the
four recommended choices:

1. **Per split:** cost centre or project, and GL code. The Commodity Code
   stays on the whole line.
2. **Where:** only where coding is done: a stage that makes Cost Centre or
   Project editable.
3. **Approval:** each share goes to its own approver.
4. **Rows:** two to ten a line.

## What was decided

- **Storage.** `invoice_line_coding_splits` (migration `0102`): one row per
  split, with its cost centre, project, GL code, the percentage typed (when
  split by %), and its net amount. They are not stored in the line's facts:
  every reader of `BT-133`, `coding.project` and `coding.gl_code` treats
  them as single values. A split line's own three are left blank.
- **Saving** (`POST /invoices/:id/key`, `lines[].splits`). Absent means
  unchanged; `[]` or `null` removes the split. Only a change is checked and
  recorded, as one `keyed_fields` row, `line.N.coding.split`, holding the
  rows before and after.
  - The split must have two to ten rows, each amount must have the line's
    sign, and the rows must add up to the line's net amount (BT-131), to
    the penny. Otherwise it is refused with `invalid_split`, naming the
    problem.
  - Each row's values are checked as a line's are (0511, 0542, 0543): on
    their lists, open, the GL code allowed for the row's cost centre and
    linked to the line's Commodity Code. A bad value is refused as
    `invalid_coding`, naming the row.
  - Under "one or the other" (0540), a row holding both a cost centre and
    a project is refused.
  - A split is refused on a PO invoice's line that is not marked Non-PO
    (0537), and where the stage makes neither Cost Centre nor Project
    editable.
- **Complete at a coding stage** (`codingGapsForTask`). Each row stands in
  for the line's cost object and GL code:
  - a cost centre or project (under "one or the other", exactly one; a
    project for a project-only supplier, 0547);
  - a GL code where the stage makes it editable;
  - values on their lists.
  Gaps name the row, e.g. "line 1 · split 2 · Cost centre or project ·
  is missing". The Commodity Code is still asked of the line itself.
- **Approval** in Cost-Object mode (0452). Each row is resolved as though
  it were the line, at its own amount, so a share within a cost centre's
  limit goes to its owner even when the whole line would not be.
  - An approver reached by two rows gets one task, and its reasoning names
    both.
  - One row that cannot resolve refuses the stage visit, as for a line.
  - Every other approval mode resolves the line as one, as before.
- **Project budgets** (0542). Only a project's share counts: in other
  invoices' spend, in the pop-out's budget line, and in
  `project.over_budget` / `project.budget_used_pct`.
- **For rules.** A row whose value stops being valid flags its line with
  `coding.split` in `coding.line_invalid` (0511), so the Coding button
  turns red.
- **Pairing a Non-PO line with a PO line** removes its split, recorded like
  its other keyed coding (0537).
- **The Coding pop-out.**
  - "Split this line" starts a split from the line's own coding, half each.
  - The Commodity Code card is labelled "whole line". Each row has a Cost
    centre | Project switch (Project alone for a project-only supplier), a
    GL code, and a share or an amount; the other column is worked out.
    Rows can be split by % or by amount.
  - A bar shows each row's part of the line. The balance line reads
    "100% allocated · …" in green, or "90% allocated · 1,200.00 still to
    allocate" in amber, with "Put it on the last row".
  - Done waits until the split balances. Pennies left by rounding go to the
    last row. Closing an unbalanced split any other way leaves the line as
    it was.
  - "+ Add a split" (up to ten), ✕ per row (down to two), and "Stop
    splitting", which keeps the first row as the line's coding.
  - A project row shows its budget use, with every share on this invoice
    counted.
  - The pop-out widens while a line is split.
- **"Split like last time."** The supplier's most recent split, as shares,
  is offered on a line that is not split. It is offered only when every row
  would still be accepted. Accept sets the rows up for the line, still to be
  checked and Done.
- **The line table.** A split line shows a "Split · n" chip in its Coding
  column: green when every row is coded, red when a row's value is invalid.
  Its hover text lists each row's share and amount. The line's Cost
  centre, Project and GL code cells read "Split".
- **Saving from the viewer.** Once any line is split, every line sends its
  rows (`[]` for none), so renumbering after a line is removed cannot leave
  a split on the wrong line. A split by percentage is worked out again from
  the line's net amount at save, so correcting that amount keeps it
  balanced.

## Not built / worth knowing

- **Line-scope rules still see the line's own cost centre, project and GL
  code, which a split line leaves blank.** A rule such as "if the cost
  centre is Facilities" does not fire for a split row. Approval routing,
  budgets and the validity flag do read the rows.
- **One approval task per approver per line**, not per row. The task names
  the line, and its reasoning names the rows.
- **There is no ERP export yet**, so nothing sends "one distribution per
  split" today. The rows are held, one per distribution, for when there is
  one.
- "Also apply to the other uncoded lines" is not offered while splitting.
- The chip's hover text names a value by its id until the pop-out or a
  suggestion has shown its name.

## Verification

- **`vf-app`**:
  - `coding-splits.test.ts` (11):
    - stored, the line's own three cleared, recorded, and read back on
      `GET /invoices/:id`;
    - resending unchanged records nothing, and `[]` removes the split;
    - refused when unbalanced, one row, or eleven rows;
    - a closed project refused, naming the row;
    - both a cost centre and a project on one row refused;
    - refused where the stage makes Cost Centre and Project read-only;
    - refused on a PO line not marked Non-PO;
    - the validity flag;
    - only the project's share counted against its budget;
    - "split like last time", and not when a row would be refused or the
      invoice is from another supplier;
    - removed when the line is paired with a PO line.
  - `approval-hierarchy.test.ts` (3): each row at its own amount; one task
    for an approver two rows reach; an unresolvable row refuses the line.
  - `workflow-engine.test.ts`: a split line raises one Approval task per
    row's approver.
  - `index.test.ts`: Complete asks each row for its cost object and GL
    code, and checks them against the lists, then completes.
- **`vf-ui`** `viewer.test.ts` (8):
  - the chip, its hover text and the "Split" cells;
  - a split line opens on its rows, balanced;
  - starting a split from the line's coding;
  - Done waits, and "Put it on the last row" fixes the balance;
  - saving sends the rows with amounts, and no cost centre;
  - "Stop splitting" sends `[]` and the first row's coding;
  - "split like last time" accepted;
  - the refusal wording.
- With the previous production files, **all 24 new tests failed**.
- Migrations: `vf-app` replay 102, all assertions held; `vf-licence`
  0203's assertion (58 rows) checked on a replay.
- Browser 1295/1296 (the known `typography.test.ts` 10px gap). Worker
  75/75. `vf-licence` 322/322.
- **`vf-app`**, a full, unfiltered run: 133 files and 3200 tests, of
  which **3198 passed**. The two failures are the ones already known on
  untouched `origin/main` (0511).
- Day and Night screenshots of the pop-out (balanced and unbalanced) and
  of the line table checked by eye.
