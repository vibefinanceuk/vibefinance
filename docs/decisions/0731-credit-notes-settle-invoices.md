# 0731: What a credit note does to the invoice it credits, configured in AP Setup

**Status: built**, awaiting deploy. vf-app (`credit-notes.ts`, `intake-capture-route.ts`,
`erp-export-route.ts`, `activity-route.ts`, `documents-route.ts`, `portal-route.ts`, the
not-payable lists, `index.ts`), shared (`vocabulary.ts`), vf-ui (`credit-notes.js`,
`ap-setup.js`, `tasks.js`, `viewer.js`, `activity.js`, `timeline-entry.js`, `app.css`),
vf-portal (Credited), migrations 0163 (vf-app) and 0334 (vf-licence strings).

## What was asked

Dan, 11 October 2026, on the credit note examination: whether a fully credited invoice
should leave payment by itself or a person confirm *"becomes a configuration option, in AP
Setup"*. The mock-up of AP Setup › Credit Notes: *"looks good"*. Then: *"lets go for step 2"*.
Step 2 of the three in the design (`docs/design/supplier-portal.md`); 0730 was step 1.

## What changed

- **The invoice a credit note credits is found** when the credit note is captured, in every
  route: the same supplier (VAT number, else name, else the matched supplier), that invoice
  number (BT-25), an invoice. In full if the credit note's total is at least the invoice's,
  otherwise in part. A rule can route on it: `creditNote.originalFound`,
  `creditNote.covers` (`full` / `partial` / `none`).
- **AP Setup › Credit Notes** (`credit_note_config`, Admin.Configure), as the mock-up:
  - in full, unpaid: **Take the invoice out of payment**, or **Ask AP to confirm first**
    (the default);
  - for part: **Pay the invoice, with the credit set against it** (the default), or
    **Hold the invoice until AP confirms**;
  - not found: **Send it to AP to find the invoice** (the default), or **Process it as
    it is**;
  - already sent for payment: always kept as a credit, the invoice marked Credited;
  - **Who confirms**: a team (none chosen: administrators);
  - **Suppliers may raise credit notes** in the network (used in step 3).
- **Credited.** The invoice's process instance becomes `credited` and its open tasks are
  cancelled: it is never exported, and it no longer takes from its PO or project budget
  (`credited` joins `archived` and `returned_manually` in every not-payable list). An
  invoice already returned or discarded is Credited too: the supplier corrected it.
  Documents says **Credited**; so does the network.
- **Credits to confirm**, at the top of Tasks for the team: each credit note waiting, what
  it credits, the supplier's note, and **Credit the invoice** / **Pay the invoice, net the
  credit** (or, where the invoice was not found, its number, or **No invoice**). While one
  waits, neither the credit note nor its invoice is exported.
- **The viewer** says, on a credit note, what it credits and how that stands; on an
  invoice, what credited it; with the same buttons while it waits, for the team.
- **The Timeline** on both: what the credit note credits, who confirmed, Credited by.
- Decided **once** per credit note (`credit_notes`): reading it again changes nothing.

Also: 0730 added BT-25 and BT-26 to the vocabulary without their field labels; they have
them now.

## Not in this

- **The network** (step 3): Raise credit note, Type and Document No.
- A Tasks badge for credits to confirm: they show at the top of Tasks, as Conversations
  and the agents' notes do.
- Undoing a decision: a credited invoice stays Credited.

## Tests

vf-app `credit-notes.test.ts`: finding the invoice (same supplier, invoice not credit
note, full or part); each option; confirm and its permission; holding from export; after
payment; returned; decided once; both Timelines; the settings. `structured-formats.test.ts`:
through email, found and not. vf-ui `credit-notes.test.ts`: the tab saves, Credits to confirm
decides, the not-found path, the viewer. Checked in Chromium, Day and Night. Migration
replay held.

## To deploy

Migrations: vf-app `0163_credit_notes.sql`, vf-licence `0334_credit_notes_strings.sql`.
Deploy vf-app, vf-licence, vf-ui and vf-portal. Choose the confirming team in AP Setup ›
Credit Notes (until then, administrators confirm).
