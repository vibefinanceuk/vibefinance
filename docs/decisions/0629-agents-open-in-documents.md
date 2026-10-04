# 0629: Agents phase 2, slice 2: Open in Documents from an agent's report

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-app migration
`0133`** and **vf-licence migration `0273`** (strings). Deploy
vf-licence, then vf-app and vf-ui.

## What was asked

Phase 2's second slice, in Dan's order (0628): links into Documents at a
report's filter. Dan, after 0628 went live: *"yes, lets go with slice
2"*.

## How

Documents already opens at exactly a list of invoices (0618's `ids`,
for Fraud Prevention's *Show all*). But that list travels in the
address, is capped at 500, and an email link must not carry it. So the
agent's report keeps the invoices behind each row, and Documents is
given the note or email copy instead: **the server looks the invoices
up, and only for the person it was sent to**. Anyone else gets none,
not everything. Documents' own access rules still apply on top.

## What was built

### vf-app

- **Rows know their invoices.** Outstanding payables and stuck work
  rows carry `_ids` (the invoices grouped into the row, or behind its
  tasks); due soon and possible duplicates already carry one
  `invoiceId`. A mark, never a column: the CSV, the email table and the
  summary's numbers are unchanged. (`rowInvoiceIds`, `tableInvoiceIds`.)
- **Migration `0133`**: `agent_deliveries.invoice_ids_json`, the
  invoices behind each email copy.
- **`GET /documents`** takes `agentNote` (with `agentRow` for one row)
  or `agentDelivery`; `agentDocumentIds` checks the note or copy is the
  signed-in person's and returns its invoices (up to 5,000) and the
  agent's name, which the response carries as `agent.name`. A failure
  note, another's note or copy, or a row that does not exist: none.
- **The email** links *Open these invoices in Documents*
  (`?agentdocs=<copy>`), in English and German, where the copy has
  invoices behind it; *Open VibeFinance* otherwise.

### vf-ui

- **A note's report** on Tasks has **Open in Documents** (every invoice
  behind it), and each row with invoices opens Documents at its own.
- **Documents** says where it came from: *Showing the invoices in the
  agent report "Weekly payables"*, and the row (*Acme UK · Kingsway*)
  when one was chosen.
- **The email link** signs in as ever, opens Documents at that copy's
  invoices, and cleans the address.
- Help lines 29 and 30.

## Not built

Past due (not yet eligible), accruals and team workload come from the
screens' own shared handlers (`handleOverdueBalance`, `handleAccruals`,
`handleWorkloadOpenTasks`), which return totals, not invoices; their
rows open nothing yet. Teaching those handlers to name their invoices is
a follow-up. Next in phase 2: agents started by an event (slice 3).

## Verification

- **`vf-app`** `agents-documents.test.ts`, 3 tests: every invoice of a
  note, one row's, a row that does not exist; each reader's own copy
  (Maya's only what she may see); someone else's note or copy opening
  nothing; each email copy linked to its own invoices; the plain link
  where a report names none. `agents.test.ts` and `agents-shape.test.ts`
  updated for `_ids`.
- **`vf-ui`** browser `agents.test.ts`, 4 new: Open in Documents from a
  note and the banner; one row, and its label in the banner; nothing to
  open where rows name no invoices; the email link opening Documents and
  cleaning the address.
- **Full runs**: vf-app 3552, of which 3550 pass (the two known failures); vf-ui browser 1535, of which 1534
  pass (the known `typography.test.ts` 10px gap), with the same 331
  unhandled errors; worker 111 of 111; vf-licence 360 of 360.
  **Migrations** replay: vf-app 133, vf-licence 273.
