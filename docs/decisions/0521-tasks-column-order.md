# 0521 — The Tasks list: the operator's column order

**Status: pushed (`f631f3a`), deployed, and migration `0186` applied, as confirmed by the operator on 27 September.**

## What was asked

> I'd like to also update the Task page, so that the order is changed.
> Please can this be changed to Document Number, Stage, Amount, Received
> Date, Waiting, Supplier Name, Owner, Action (I.e. Claim)

## What was decided

**The columns now read, in order:** Document Number, Stage, Amount,
Received Date, Waiting, Supplier Name, Owner, Action.

**The document number and the supplier are now two columns.** They used
to share one cell.

- **Document Number** is the invoice's BT-1. A line-level task shows its
  line beside the number (*INV-1042 · line 3*), because that is what
  identifies the part of the document it is about. An invoice with no
  number yet reads "Not yet keyed".
- **Supplier Name** is the seller's name, falling back to the VAT number
  as before (0112).

**Two new columns:**

- **Received Date** shows when the invoice arrived. It is the same value
  the Documents list shows.
- **Action** is the task's buttons. Its heading was previously blank.

**Server (`task-list-route.ts`):** each task's `subject` now carries
`invoiceNumber` (BT-1 from the facts, read as `documents-route.ts`
reads it) and `receivedAt` (the header's `created_at`).

**`vf-licence` migration `0186`:**

- adds `tasks.document` (Document Number / Belegnummer),
  `tasks.received` (Received Date / Eingangsdatum) and `tasks.action`
  (Action / Aktion);
- renames `tasks.supplier` to Supplier Name / Lieferantenname.

## What was verified

- **`tasks.test.ts`:**
  - The headings are exactly the operator's eight, in order.
  - Each cell carries the number, stage, received date and supplier.
  - A line task shows its line beside the number.

  The new tests **failed** with `tasks.js` stashed.
- **`task-list-route.test.ts`:** the subject carries `invoiceNumber` and
  `receivedAt`.

## Verification (0521 and 0522 together)

- **`vf-app`**, a full, unfiltered whole-suite run: 126 files and 3083
  tests, of which **3081 passed**. The two failures are the ones
  confirmed on untouched `origin/main` since 0511.
- **`vf-ui`**: Worker 75/75. Browser 1208/1209. The one failure is the
  known `typography.test.ts` `10px` gap.
- **`vf-licence`**: 320/320.
- **`npx eslint`** on every touched file: clean.
