# 0542 — A Project has a status and a budget

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle, together
with 0543. It touches `vf-app`, `vf-ui`, `vf-licence` and `shared`
(vocabulary), and needs **`vf-app` migration `0099` (apply before
deploying `vf-app`) and `vf-licence` migration `0197`**.

## What was asked

From the coding discussion (Cost Centre as an ongoing department, a
Project as a temporary initiative with its own budget), the operator
asked for "project status and budget" first. Asked what should happen
when a line takes a project over budget, they chose **warn and expose
to rules**: never block a save.

## What was decided

- **Status.** Every Account Coding list entry now has a status,
  `active` (the default) or `closed` (migration `0099`). AP Setup sets it
  on Projects (a Status column and a picker in the Project form).
  - A closed entry is **not offered** in the Coding pop-out (its search
    asks for `activeOnly=1`; looking up a line's existing value still
    finds it, so its name still shows).
  - **Saving** a line coded to a closed entry is refused
    (`invalid_coding`, reason `closed`, "is closed").
  - A line **still coded** to a project that has since closed is flagged
    by 0511's `coding.line_invalid`, so its Coding button turns red and
    Complete at a coding stage refuses it until it is recoded.
- **Budget.** A Project may have a budget (`budget_amount`, NULL for
  none; only a project can have one).
  - **What it has used** is computed, never stored: the net amount
    (BT-131) of every invoice line coded to it, leaving out invoices that
    were discarded or returned to the supplier (the same rule as PO
    consumption, 0533).
  - **The Coding pop-out** shows a bar under the chosen project, in the
    PO usage bar's colours: other invoices, this invoice's lines on it
    (as they stand on screen, saved or not), and what is left. Over
    budget turns it red and says "Over budget by …". It is not shown for
    a project with no budget. A new route,
    `GET /invoices/:id/project-usage?project=…`, returns the budget and
    what other invoices have used (same permissions as coding
    suggestions).
  - **For rules**, each line coded to a project with a budget carries
    `project.over_budget` (true when other invoices plus this invoice's
    lines on it exceed the budget) and `project.budget_used_pct`. Both
    are new vocabulary facts, absent on every other line. Nothing routes
    on them by default; a rule can, for example to send over-budget
    invoices to the project's approver.

## Found in passing, fixed here

**Coding suggestions never reached the live screen.** vf-ui's proxy
allowlist never included `/invoices/:id/coding-suggestions`, so since
0457 the pop-out's request was answered "not found" and it silently
showed no suggestion. It is added now, with the new budget route, and
the proxy test lists both. Every other `/api/` path the screens call
was checked against the allowlist; nothing else was missing.

## Not built / worth knowing

- Budgets are compared across invoices as the amounts stand, whatever
  each invoice's currency.
- No start or end dates on a project.
- Setting a status on Commodity or GL codes works on the server but
  isn't in AP Setup yet.

## Verification

- **`vf-app`**:
  - `coding-list-route.test.ts` (3): creating with a budget (active by
    default), closing and re-budgeting, the active-only search, and what
    is refused. One earlier test comparing the whole entry now includes
    the two new fields.
  - `project-budget.test.ts` (6): spend by others (this invoice and a
    returned one left out); the usage route (404, 400, no budget);
    `project.over_budget`/`budget_used_pct` with this invoice's lines
    counted together; within budget; a closed project refused on save
    ("is closed") and flagged once it closes.
  With the previous `coding-validation.ts` and `coding-list-route.ts`,
  the 7 tests of new behaviour **failed** (plus the updated shape test).
- **`vf-ui`**: `coding-lists.test.ts` (status and budget shown and
  saved; the create body now carries both); `viewer.test.ts` (3: the bar
  and over-budget warning, within budget, no budget; search is
  active-only while a name lookup isn't); the proxy test in
  `test/index.test.ts` **failed** without the allowlist fix. All 4 new
  browser tests **failed** with the previous `viewer.js` and
  `coding-lists.js`.
- See 0543 for the full-suite counts, run once for both.
