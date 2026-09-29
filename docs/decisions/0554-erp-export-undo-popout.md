# 0554 — Undo an ERP export in the app's own pop-out

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
touches `vf-ui` and `vf-licence`, and needs **`vf-licence` migration
`0206`**; no `vf-app` change or migration.

## What was reported

After 0553 was deployed, the operator found that Undo "launches the
browser native control, and not a control consistent with the other
message boxes on screen", and asked for the same look and feel as the
rest of the UI.

## What was decided

- Undo opens the app's own pop-out. It uses the same `.backdrop` /
  `.popout` shape as Discard, Return and Return To Supplier, which were
  each moved off the browser's prompt for the same reason (decisions 0490
  and 0498).
- The pop-out has:
  - a heading, "Undo this export", with Undo (primary) and Close;
  - what will happen: "The export of {when} is undone: its {n} invoices go
    back to Ready to export, to be exported again. The file stays in Past
    exports.";
  - a labelled reason box, with an example as its hint;
  - an in-pop-out message when the reason is empty, instead of a call to
    the server: "Give a reason. It shows on the Timeline of each invoice in
    the export." A server refusal is shown there too.
- It closes by Close, Escape or a click outside, without undoing
  anything. After a successful undo it closes, reloads the lists and says
  how many invoices are back.
- The reason box is focused when the pop-out opens.

## Verification

- `vf-ui` `erp-export.test.ts` (4 new):
  - the pop-out opens, and the browser prompt is never called; it has the
    heading, what will happen, the label, focus in the reason box, and
    Undo and Close;
  - an empty reason is asked for in the pop-out, with no call to the
    server;
  - the typed reason is sent trimmed, the pop-out closes, and the message
    shows;
  - Close, Escape and a click outside all close without undoing.

  With the previous `erp-export.js`, all four **failed**. The whole file
  passes 9/9. Browser 1310/1311 (the known `typography.test.ts` 10px gap).
- `vf-licence` 0206 (10 rows) checked on a replay; `vf-licence` 322/322.
- Day and Night screenshots of the pop-out checked by eye.
