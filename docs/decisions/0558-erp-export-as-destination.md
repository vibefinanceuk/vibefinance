# 0558 — Routes, slice 4: the ERP export as a Destination

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-app` migration
`0108` (apply before deploying `vf-app`) and `vf-licence` migration
`0209`**.

## What was asked

Slice 4 of the Routes design (`docs/design/routes-phase1-data-model.md`
section 7): the ERP export driven by its Destination. Its payment-eligible
read from each process's exit stage, each export an outbound message in
the Route monitor with its failures there, and the Destination panel on
Process routes.

## What was decided

- **Payment-eligible reads each process's declared exit stage** (0557):
  an invoice whose process has completed, or which sits at that stage.
  Until now it was the process's highest-numbered stage ever created. For
  the Standard AP Process that is the same stage, Payment Eligible, so
  nothing changes today. The difference is that adding a stage after it,
  or publishing a version without it, no longer moves the export
  somewhere else. A process whose stages belong to no version falls back
  to its stages by sequence, as before.
- **Pause and resume the ERP Destination** from its panel on Process
  routes (`PATCH /route-instances/:id`, `Admin.Configure`). While it is
  paused, nothing of its process is exported. Its invoices stay ready,
  and its card and panel say how many are waiting. It is for
  Destinations only: a Source instance is changed through its source.
- **Each export is an outbound message**, one for each process whose
  invoices it took, on that process's ERP Destination:
  - it is delivered when made, with the invoices it carried and its
    history (exported, by whom, then delivered);
  - **the file it carried is kept in R2** as its `sent` part: that
    process's own rows, byte for byte (BOM included), under the same key
    scheme as an incoming message's parts. D1 keeps the rows as before,
    and the ERP export screen downloads from them exactly as it did;
  - recording never undoes an export: a failure to record leaves the
    export made, and simply missing from the monitor.
- **Undoing an export closes its messages.** Each is marked as failed at
  delivery, with code `undone` and the reason given, and **dismissed**
  rather than failed: its invoices are ready to go again, so it is dealt
  with, not waiting to be fixed, and it is not counted in *Failed, not
  yet fixed*. The history says who undid it.
- **Migration `0108`**:
  - an outbound message names its Destination in a new
    `route_messages.destination_id`. `instance_id` names a source (0106),
    and a Destination instance is not one. A new column keeps every row
    and every table that references `route_messages` untouched, where
    rebuilding the table would not;
  - `erp_export_id` links a message to its export;
  - **exports made before this become messages**: one each, on the ERP
    Destination of its first invoice's process, with its invoices and
    history, an undone one closed with its reason. They have no stored
    file, which is still downloaded from the ERP export screen as always;
  - an ERP Destination for any process that had exports but no source;
  - standing invariants: an inbound message never names a destination;
    an outbound one always does, never a source, and only a Destination
    instance; an undone export's messages are dismissed, and only then.
    A test applies 0108 to a database with exports, one undone
    (`migrations/tests`).
- **The Route monitor**:
  - Destinations can be filtered by, beside sources;
  - an export's row says "sent out" and "→ 12 invoices sent" (or
    "→ invoice INV-3104 sent"), and an undone one "Undone";
  - opened, its five parts run the other way, from Process to Gateway,
    with the Gateway failed for an undone export;
  - its explanation is amber, not red, because it is dealt with;
  - "Invoices it sent" and "What was sent" list the invoices and the file
    it carried, with the file downloadable;
  - the history says who did what: "Exported · by Olga", "Undone · by
    Olga".
- Process routes' ERP note says what the Destination does now, and the
  screen opens on the flow alone on each visit.
- Strings in English and German (`vf-licence` `0209`, which also updates
  the ERP note).

## Not built / worth knowing

- **The ERP export screen itself is unchanged.** It still exports every
  eligible invoice in the person's units in one go, then records one
  message per process. Exporting one Destination at a time, an API push
  and ERP-specific layouts are the later enhancement the operator
  planned.
- "Once only" is still enforced by `erp_export_invoices`, one row per
  invoice, as 0552 built it. That is the same thing, per Destination, while
  each process has one ERP Destination.
- An export message's *Delivered* means the file was made and downloaded.
  An ERP confirming its import (an acknowledgement coming back) comes
  with an API Destination.
- Reprocess, dismiss and alerts are slice 5.

## Verification

- **`vf-app`** `erp-destination.test.ts` (8):
  - eligible at the exit stage, or completed, and not before it;
  - the declared exit stage, not the highest-numbered stage;
  - a paused Destination takes nothing, still counts what waits, and
    refuses an empty export; resumed, it takes them again;
  - pausing is for Destinations only, active or paused;
  - an export's message: on the process's ERP, delivered, its invoices,
    its history with who, and the file in R2 byte for byte as the rows;
  - two processes, two messages;
  - without R2, recorded without the file;
  - undone: dismissed, failed at delivery, `undone` and the reason, who
    undid it, listed on the ERP, and not counted as a failure to fix.

  With the previous production file, 6 of the 8 failed. `index.test.ts`:
  pausing through the real router needs `Admin.Configure`. The existing
  `erp-export.test.ts` passes unchanged.
- **Migration**: `migrations/tests/test_0108_erp_destination_backfill.py`
  passes; `vf-app` replay 108, all assertions held.
- **`vf-ui`**: `route-monitor.test.ts` (browser, 9) and `routes.test.ts`
  (browser, 8), with the real strings: an export listed as sent out and
  undone, filtered by its Destination; opened process to gateway, amber,
  with the file sent and who did what; the ERP panel's Pause, and a
  paused one's Resume and note.
- `vf-licence`: string coverage lists the new keys; 322/322; replay 209.
- **`vf-app`**, a full, unfiltered run: 138 files and 3256 tests, of which
  **3254 passed**; the two failures are the ones already known (0511).
- **`vf-ui`**: worker 75/75; browser 1327/1328 (the known
  `typography.test.ts` 10px gap).
- Day and Night screenshots of an undone export in the monitor and a
  paused ERP on Process routes, checked by eye.
