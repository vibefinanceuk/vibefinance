# 0552 — The ERP export: a CSV file of payment-eligible invoices

**Status: built and tested locally, not yet pushed or deployed.** Delivered
with 0550 and 0551. Touches `vf-app`, `vf-ui` and `vf-licence`, and needs
**`vf-app` migration `0104`** and `vf-licence` migration `0204`.

## What was asked

0548 noted there was no ERP export, so a split had nowhere to go as
separate distributions. The operator chose:

- **a CSV file download** for now; an API push and ERP-specific formats
  are planned as a separate, later enhancement;
- **payment-eligible invoices, each exported once**.

## What was decided

- **Payment-eligible** is the accruals report's definition (0417): the
  invoice's process has completed, or it sits at its process's final
  stage. A discarded or returned invoice (`archived`, `returned_manually`)
  never is.
- **Each once.** `erp_export_invoices` (migration `0104`) has one row per
  invoice ever exported, keyed on the invoice, so two exports can never
  both take it. An export made while another takes the same invoices
  fails whole ("try again") rather than sending any twice.
- **The same file every time.** `erp_export_rows` keeps each export's rows
  as they were taken, so downloading an export again gives the same file
  after an invoice is corrected.
- **One row per distribution** (`ERP_EXPORT_COLUMNS`):
  - export, invoice id and number, issue and due dates;
  - supplier ERP id, site, name and VAT id;
  - company (org unit), currency, invoice net / VAT / total, PO number;
  - line number, split row, PO line, description, quantity, unit, net
    amount, VAT category and rate;
  - cost centre, project, commodity code, GL code.

  How rows are produced:
  - A split line gives one row per split, at its own amount (0548).
  - A line holding no coding of its own takes the invoice's.
  - An invoice with no lines gives one row, its net worked out from total
    less VAT where no net is given.
- **The file.** RFC 4180 CSV with a UTF-8 byte-order mark (so Excel reads
  accents), amounts as `1234.50`. A text cell starting like a formula
  (`=`, `+`, `-`, `@`) gets a leading apostrophe, so a supplier's
  description can never run as one.
- **Permission: `AP.Export`**, new, scoped by unit. It is its own
  permission because sending invoices on to be paid is neither reviewing
  nor configuring. An export spanning units a person does not hold is not
  listed or downloadable for them. The permission vocabulary's standing
  invariant (0048) is restated in migration `0104`.
- **Routes:** `GET /erp-exports` (what the next export would take, and past
  exports), `POST /erp-exports`, and `GET /erp-exports/:id/csv` (a file
  download), all proxied by `vf-ui`.
- **The screen:** "ERP export", in a new **Integration** group at the end of
  the menu, so no existing screen changes colour (0527). It has two
  panels:
  - "Ready to export", listing the invoices, with "Export n invoices",
    which makes the export and downloads its file;
  - "Past exports", each with Download.

## Not built / worth knowing

- No API push or ERP-specific layouts yet (planned). They can read the same
  stored rows.
- **No one holds `AP.Export` until it is added to a role** on the Access
  screen.
- An export cannot be undone from the screen. An invoice once exported
  stays exported.
- A PO-matched line exports its own coding or the invoice's; coding is not
  taken from the PO.
- Nothing is written to an invoice's Timeline when it is exported.

## Verification

- `erp-export.test.ts` (5):
  - only payment-eligible, never-exported invoices, in the person's units;
  - the export's rows: the split rows, invoice coding where a line has
    none, a header-only invoice, the formula guard;
  - taken once, and a second export refused;
  - the same file after a correction;
  - another unit's export kept out of reach;
  - CSV quoting.
- `index.test.ts` (2): `AP.Export` required; list, empty export refused,
  unknown file 404; the CSV download's headers.
- `vf-ui`:
  - `erp-export.test.ts` (4): the two panels; export and download under
    the server's file name; downloading a past export; nothing waiting.
  - `tasks.test.ts`: Integration last in the menu, with Processes keeping
    its colour.
  - The proxy test lists the three routes.
- With the previous files (and without the new modules), every new test
  **failed**.
- Migrations: `vf-app` replay 104, all assertions held; `vf-licence` 0204
  (52 rows) checked on a replay.
- Browser 1304/1305 (the known `typography.test.ts` 10px gap). Worker
  75/75. `vf-licence` 322/322. `shared` 298/301, the 3 known failures.
- **`vf-app`**, a full, unfiltered run for 0550–0552: 134 files and 3211
  tests, of which **3209 passed**. The two failures are the ones already
  known on untouched `origin/main` (0511).
- Day and Night screenshots of the screen checked by eye.
