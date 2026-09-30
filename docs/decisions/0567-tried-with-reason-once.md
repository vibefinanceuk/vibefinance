# 0567: A failed file's card names its mapping once

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-ui` only. There is no migration.

## What was asked

Dan confirmed 0566 live on 30 September, and quoted the card for the
two-invoice CSV:

> Tried with vibefinanceuk@gmail.com CSV, version 2: vibefinanceuk@gmail.com
> CSV v2: the file holds 2 invoices (88252, 88253); one invoice per file is
> read

The mapping is named twice. The part's reason from `vf-app` names the
mapping and version itself, because that same reason is shown on its own
in the technical detail and the history.

## What was decided

The card drops a leading `<mapping name> v<version>: ` from the reason
when it is there (`withoutMappingName` in `route-monitor.js`). The card has
just named both. The stored reason is unchanged, so the technical detail
and the history still name the mapping on their own.

The card now reads: "Tried with vibefinanceuk@gmail.com CSV, version 2:
the file holds 2 invoices (88252, 88253); one invoice per file is read".

## Verification

- **`vf-ui`** browser `mapping-editor.test.ts`: the 0566 test now gives the
  reason as `vf-app` writes it, with its prefix, and expects the card to
  name the mapping once. It fails against 0566's interface.
- Full browser suite: 1366 of 1367 pass. The one failure is the known
  `typography.test.ts` 10px gap.
