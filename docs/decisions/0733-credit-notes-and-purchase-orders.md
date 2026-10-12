# 0733: A credit note gives back what it credits on the PO, and is not matched to it

**Status: built**, awaiting deploy. vf-app (`po-matching.ts`, `credit-notes.ts`,
`purchase-order-route.ts`, `po-match-panel-route.ts`, `project-budget.ts`).

## What was asked

Dan, 11 October 2026: *"does a credit note need to be matched to a PO, so that amount billed
can be reversed?"* No: it reverses through the invoice it credits, which was the one matched.
Looking, two things were wrong: a credit note naming a PO was counted as **another invoice
billing against it** (adding to what the PO had used, where it should take away), and it went
through PO matching as an invoice would (Dan's credit note stopped at Matching with *PO line
not found*). Dan, 12 October: *"yes, lets make those fixes"*.

## What changed

- **A credit note gives back what it credits.** What a PO has used (matching, the PO matching
  panel, the Purchase Orders screen's Invoiced in part / in full, GRNI) and what a project has
  spent count a credit note's amount, and its lines' quantities and amounts, **negative**. One
  whose invoice was Credited (0731) counts for nothing: the invoice already counts for nothing,
  and counting both would give it back twice.
- **A credit note is not matched to its PO.** It gets no `po.*` facts and no receipt facts, so
  no matching rule stops it (an absent fact never fires). A rule can still route it on
  `creditNote.originalFound` and `creditNote.covers`.

## Tests

vf-app `credit-notes.test.ts`: a netted credit note takes 24 off a 120 invoice's PO and a line
off its PO line; once the invoice is Credited, both count 0; a credit note gets no `po.*`
facts where an invoice does. The PO, panel, Purchase Orders, project budget, GRNI and receipt
tests pass unchanged.

## To deploy

Deploy vf-app. A credit note already stopped at Matching is visited afresh when its task is
completed or it is read again; nothing to migrate.

## Afterwards: the PO of the invoice it credits

Dan, 12 October: *"a credit against the invoice would need to decrease the billed amount"*.
It did only when the credit note itself named the PO (BT-13); one from email often names only
the invoice it credits. A document now counts against its own PO, or, for a credit note with
none, the PO of the invoice it credits (`poOfSql`): matching, the panel, the Purchase Orders
screen and GRNI. Its lines give back against PO lines only where they name one. Deploy vf-app.
