# 0553 — An ERP export on the Timeline, and undoing an export

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-app`
migration `0105`** and `vf-licence` migration `0205`.

## What was asked

The two follow-ups offered after 0552, both taken:

- "Exported to ERP" on each invoice's Timeline;
- undoing an export, for when a file failed to import on the ERP side,
  so its invoices can be exported again.

## What was decided

- **Undo works on a whole export, and needs a reason**
  (`POST /erp-exports/:id/undo`, `AP.Export`, the same unit reach as
  downloading):
  - the export's invoices go back to Ready to export (their
    `erp_export_invoices` rows are removed), so the next export takes them
    again;
  - the export is kept, marked undone with who, when and why (migration
    `0105`: `reversed_at`, `reversed_by`, `reverse_reason`, all three or
    none);
  - its rows stay, so the file it produced can still be downloaded;
  - an export can be undone once. Standing invariants: an undone export
    holds no invoices, and "undone" always has all three details.
- **The screen.** Each past export has Undo beside Download, which asks why
  in a prompt. An undone export stays listed, marked "Undone by … , …" with
  the reason, and keeps Download.
- **The Timeline** (derived, like every system line: 0267).
  - "{who} exported this invoice to the ERP", from any export whose rows
    include it. The rows are kept even after an undo, so this line stays.
  - Where that export was undone: "{who} undid its ERP export, so it is
    back in Ready to export", with the reason under it.
  - The lines use the Download and Return icons. Their times are written as
    task actions write theirs, so they sort among them.
- **Reach** of an export (list, download, undo) is now judged by the
  invoices in its rows, which an undo leaves in place. Before, it was
  judged by `erp_export_invoices`, which an undo empties.

## Not built / worth knowing

- Undo applies to a whole export, not one invoice in it.
- Undoing does not recall anything already imported into the ERP. It only
  lets VibeFinance export those invoices again.

## Verification

- **`vf-app`**:
  - `erp-export.test.ts` (3): the Timeline line after an export; undo
    needs a reason, returns the invoices to Ready to export, keeps the same
    file, lists the export as undone with who and why, adds the Timeline
    line with the reason, and refuses a second undo; the invoices then
    export again, and the Timeline shows export, undo, export. Undo is
    refused for an export out of reach.
  - `index.test.ts`: undo through the router.
- **`vf-ui`**:
  - `erp-export.test.ts` (3): Undo asks why and says what it did; nothing
    happens without a reason; an undone export is marked, keeps Download,
    and offers no Undo.
  - `viewer.test.ts`: both Timeline lines, the reason, and their icons.
  - The proxy test lists the undo route.
- With the previous files, **all 8 new tests failed** (plus the proxy
  list).
- Migrations: `vf-app` replay 105, all assertions held; `vf-licence` 0205
  (16 rows) checked on a replay.
- Browser 1308/1309 (the known `typography.test.ts` 10px gap). Worker
  75/75. `vf-licence` 322/322.
- **`vf-app`**, a full, unfiltered run: 134 files and 3214 tests, of
  which **3212 passed**. The two failures are the ones already known on
  untouched `origin/main` (0511).
- Day and Night screenshots of the screen with an undone export checked by
  eye.
