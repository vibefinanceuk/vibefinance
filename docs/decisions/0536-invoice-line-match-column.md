# 0536 — The invoice line table gets a Match column

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-app`
migration `0095` (apply before deploying `vf-app`) and `vf-licence`
migration `0192`**.

## What was asked

After pairing lines on INV-SEED-006 through the PO matching panel:

> once matched, the line items at the bottom do not indicate that the
> matching has taken place. I wondered if we need an icon, maybe
> replacing the account coding icon that launches a pop-out showing
> what has been matched to.

A chip in its own column was proposed instead of replacing the Coding
button (a PO invoice can still need coding, and 0511 marks that button
red when coding is not on the lists). The operator agreed:

> I think - 1. A chip in its own column, perhaps with the heading
> 'Match', and hover text indicating the colour code. 2. Read-only
> outside of the matching stage. If changes are needed, the user can
> 'Return' to matching later in the process.

## What was decided

- **A Match column**, after the line fields and before the line
  actions, shown only when the invoice names a PO (BT-13). Coding keeps
  its own button.
- **One chip per line, coloured by the server's verdict:**
  - green `L{n} ✓`: matches PO line n;
  - amber `L{n} · +4.3%` (the price or quantity variance),
    `L{n} · unit` (the units differ) or `L{n} · check`;
  - red `No PO line`;
  - a small dot when a person made the pairing (by hand, or by
    accepting a suggestion), as against the supplier's own reference.
- **Hover text**: the line's own verdict and who paired it, then what
  each colour means. The column heading carries the legend too.
- **Clicking a chip opens a read-only pop-out**: the invoice line
  against its PO line, the verdict, how the two were paired, and how
  much of the PO line is used (0533's bar). It changes nothing.
  - **At Matching, on the person's own task**, it also offers **Open PO
    matching**, the same test as the topbar button (0530/0531). The
    panel's own routes still decide what may change.
  - **Everywhere else** it says the line is read-only and to return the
    invoice to Matching to change it, as the operator said.
- **The summary rides on `GET /invoices/:id`** as `poMatch`
  (`po-line-summary.ts`), so anyone who can open the invoice sees it,
  an approver included, without a PO permission of their own. It uses
  the same saved pairings (0532), consumption (0533) and
  `computePoLineMatch` the rules read, so the chip and the rules cannot
  disagree. `null` for an invoice with no BT-13. When BT-13 names a PO
  not held here, every line is red and the pop-out says so.
- **An accepted suggestion is recorded as one.** `vf-app` migration
  `0095` adds `invoice_line_po_pairings.source` (`manual` or
  `suggestion`, default `manual`). Accept (0534) sends
  `source: "suggestion"`; the picker sends `manual`; anything else is
  read as `manual`. The panel and the pop-out say "Suggestion accepted
  by {who}" instead of "Paired by {who}". Existing pairings read as
  by hand.

## Not built / worth knowing

- **A line added in the viewer and not yet saved** shows `—` in the
  column until it is saved and the document reopened; the summary is
  per stored line.
- **The chip reflects what is saved**, not unsaved edits to quantity
  or amount in the table.
- Still open from 0534's test pack: matching ignores PO status (a
  closed or on-hold PO still matches).

## Verification

- **`vf-app` `po-match-panel.test.ts`**, three new tests: the invoice
  GET carries each line's state and PO line, with the panel's own
  verdict; a pairing records `suggestion` or `manual` (anything else is
  `manual`); `null` with no BT-13, and every line `nopoline` for a PO
  not held. All three **failed** with the `poMatch` field removed and
  the source forced to `manual`.
- **`vf-ui` `po-match.test.ts`**, five new tests (chip colours and
  text, the dot, hover legend, read-only pop-out, Open PO matching,
  "Suggestion accepted by"), and Accept now asserts
  `source: "suggestion"`. **`viewer.test.ts`**, four new tests: the
  column and legend, its position after the line fields, no column
  without a PO, read-only outside Matching, and Open PO matching only
  on the person's own Matching task. With the production files
  reverted, 8 of the 10 failed; the two that passed test the no-PO case
  and the pop-out given a callback, which hold either way.
- `vf-app` migration replay: 95 migrations, all assertions held.
  `vf-licence` 0192's assertion (34 rows) checked against a replay.
- Browser 1250/1251 (the known `typography.test.ts` 10px gap). Worker
  75/75. `vf-licence` 320/320.
- **`vf-app`**, a full, unfiltered run: 128 files and 3125 tests, of which **3123 passed**. The two failures are the ones already known on untouched `origin/main` (0511).
- Screenshots of the column and the pop-out were checked by eye.
