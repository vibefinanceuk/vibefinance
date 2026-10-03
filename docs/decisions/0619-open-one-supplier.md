# 0619: Open one supplier, from a Fraud Prevention list

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-licence`
migration `0262`** (strings). Deploy vf-licence, vf-app and vf-ui. No
`vf-app` migration.

## What was asked

Dan, 3 October 2026, from the open items after 0618: *"Open a single
supplier from the Suppliers screen. This would also let a supplier in a
Fraud Prevention list open that supplier."*

## What was decided

- **`openSupplierById(id, name)`** (`suppliers.js`) opens the Suppliers
  screen as usual and then **that supplier's card over it**, the same
  card clicking its row opens, with everything it offers (details, hold,
  release, deactivate). The supplier is asked for by id, in the person's
  own scope and the org chosen at the top of the page; one outside them
  is not opened, and the screen says *Gone Ltd is not among the
  suppliers you can see for the organisation chosen*.
- `GET /api/suppliers` takes **`id`**: the same list, scope, permission
  (AP.Supplier) and shape, narrowed to that one supplier (search and
  status ignored).
- **In Fraud Prevention**, a supplier's name is a link to it where the
  check knows which supplier it is and the person holds **AP.Supplier**:
  potential duplicates, unapproved-supplier invoices (on hold; one *not
  on file* has none), statistical outliers, and exception trends' *By
  supplier* tab. The rest of the row still opens the invoice (or, in
  exception trends, Documents). Without AP.Supplier, or with no matched
  supplier, the name is plain text. The link opens from the keyboard
  too, without also opening the row.
- The duplicates and unapproved-supplier routes now return
  **`supplierId`** (null where none is matched).

## Not built

- The same link from elsewhere a supplier is named (the invoice viewer,
  Supplier Performance's cards): `openSupplierById` is ready for them.
- An address of its own for a supplier (a link to paste): the app has
  no per-screen addresses yet.

## Verification

- **`vf-app`** `load-suppliers.test.ts`, 2 new tests: one supplier by id
  whatever search and status say, and none for an unknown id.
  `fraud-duplicates.test.ts` and `fraud-unapproved-suppliers.test.ts`,
  1 each: `supplierId` where matched, null where not. 4 fail against the
  routes before this change. Full run 3471, of which 3468 pass (the three
  known failures).
- **`vf-ui`** browser `open-supplier.test.ts`, new, 4 tests, signed in
  through `start()`: the name a link with AP.Supplier and plain text
  without a matched supplier; plain text without AP.Supplier; a click
  asks for the supplier by id and opens its card, not the invoice; a
  supplier out of sight is said on the Suppliers screen and no card
  opens. 3 fail against the interface before this change. Full run
  1495, of which 1494 pass (the known `typography.test.ts` 10px gap),
  with the same 331 unhandled errors as before; worker 111 of 111.
- **`vf-licence`** 358 of 358. **Migrations** replay: `vf-licence` 262.
