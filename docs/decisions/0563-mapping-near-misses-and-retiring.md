# 0563: Supplier mappings: why one did not read, and retiring one

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs two migrations:

- **`vf-app` `0112`**, applied before deploying `vf-app`;
- **`vf-licence` `0214`**.

## What was asked

On 30 September Dan created a mapping from a failed supplier XML, saved it
several times, and asked how to associate it with the failed invoice. We
looked at the live environment together (he signed in; the data was read
only) and found:

- The failed invoice, `Rechnung_88240.xml`, came from
  `vibefinanceuk@gmail.com`.
- The live mapping for `<Rechnung>` was for `danielyoung76@gmail.com`, and
  another live one for `@xrech001.com`.
- Two mappings for `@gmail.com`, which would have read it, were drafts: two
  clicks of **Map this format**, never published.
- The invoice had been reprocessed six times. Each time it failed with
  "no mapping on this route reads it yet", which was not true.
- The editor had offered to reprocess it, because its "waiting" count
  ignored the sender.

Dan added the address to "Who it is for", reprocessed, and the invoice was
delivered. He then asked for the three fixes suggested:

- count as waiting only what the mapping would read;
- say which mapping came close, and why it did not read;
- a way to retire the unused drafts.

## What was decided

### Waiting counts only senders the mapping is for

`waitingFor` now takes the mapping and keeps only the failed messages
whose sender matches "Who it is for". This applies wherever the count
appears:

- the Publish result and its **Reprocess N messages**;
- the editor;
- the Routes screen's Supplier mappings panel.

### A near miss is named, with its reason

Where no live mapping reads a supplier's own XML, intake looks for one that
came close on the same route and root. There are two cases, checked in
this order:

| Case | Meaning | Reason on the part |
|---|---|---|
| `not_published` | A mapping for this root and this sender exists, but has never been published | the mapping "…" would read it, but has not been published |
| `not_for_sender` | A live mapping reads this root, but "Who it is for" does not include this sender | the mapping "…" reads <Rechnung> on this route, but is not for … |

`not_published` comes first: it is the closer of the two, and publishing
fixes it.

The part records the mapping in `mapping_id`, with `mapping_version` left
NULL because it did not read the file, and the case in a new column,
`mapping_miss` (migration `0112`). An invariant checks both. Where nothing
came close, the reason is unchanged, and so is **Map this format**.

In the Route monitor:

- **Explanation:** its own title, body and fix for each case. For
  `not_for_sender`, the fix says that "Who it is for" applies at once,
  without publishing again. That is how it already worked: the senders sit
  on the mapping, not on a version.
- **E-invoice checks line:** a pill ("Not for this sender" or "Mapping not
  published"), the mapping's name and the sender, and **Open the mapping**
  instead of **Map this format**.

### Retiring a mapping

The endpoint is `POST /supplier-mappings/:id/retire`, under
`Admin.Configure` like the rest.

- The mapping is marked retired, with who retired it and when (migration
  `0112`).
- It stops reading at once, and leaves the Routes screen's list.
- Its versions are kept as they were, as history, and parts it read still
  name it.
- Saving, publishing or retiring it again is refused with `409` and
  `reason: "retired"`.
- The response says whether it was live.

In the editor, **Retire this mapping** sits on the Mapping card. It asks on
the card itself, never in a browser dialog, and says what retiring means:

- for a live mapping, that invoices it reads today will fail until another
  mapping reads them;
- for a draft, that no invoice is affected.

After retiring, the editor returns to Routes, which shows "… is retired."
Opening a retired mapping shows it as retired, with nothing to publish,
save or retire.

### Help

The mapping editor's help gains a *Retiring a mapping* section. Its lines
on saving, reprocessing and failures now mention:

- "Who it is for" applying at once;
- only matching senders being offered for reprocessing;
- the two near misses.

The Route monitor's supplier XML line mentions them too. All of it is in
English and German, in `vf-licence` `0214`: 21 new keys, and 4 updated.

## Not built

- **Un-retiring a mapping.** Draw a new one from a kept message instead.
- **Retiring from the Routes screen's list.** It is done from the editor,
  where what it means is said.
- **Stopping a second click on Map this format from making a second
  mapping.** A near miss now names the draft that already exists, and a
  draft made by mistake can be retired.

## Verification

- **`vf-app`** `supplier-mappings.test.ts`, now 18 tests. Six fail against
  the code before this change:
  - `not_for_sender`, with its reason in words and the monitor's part
    naming the mapping;
  - `not_published`;
  - no near miss where nothing came close;
  - waiting counts only matching senders, and adding the sender makes the
    message reprocessable and delivered, with no new publish;
  - retiring: it stops reading, leaves the list, keeps its versions,
    refuses edits, publishing and a second retire, and 404s an unknown id;
  - retiring a draft says it was not live.

  One earlier test now expects the near miss for another sender.
  `index.test.ts` checks, through the real router, that retire needs
  `Admin.Configure`, and covers 404 and 405. Full, unfiltered run: 141
  files and 3297 tests, of which **3295 passed**. The two failures are the
  ones already known (0511).
- **`vf-ui`** browser `mapping-editor.test.ts`, with 5 new tests using the
  real strings. All 5 fail against the interface before this change:
  - the monitor for each near miss: pill, line, explanation and **Open the
    mapping**;
  - retiring a draft: the prompt, Keep it, Retire it, and the Routes
    notice;
  - the warning for a live mapping;
  - a retired mapping shows nothing to change.

  Full browser suite: 1357 of 1358 pass. The one failure is the known
  `typography.test.ts` 10px gap. Worker tests: 75 of 75.
- **`vf-licence`**: 322 of 322 pass, including the escape-sequence test,
  and string coverage with the new keys.
- **Migrations**: `vf-app` replays 112; `vf-licence` replays 214.
- **Screenshots**, checked by eye: the retire prompt on the Mapping card,
  and the Route monitor for Dan's own case (`not_for_sender`, naming
  "danielyoung76@gmail.com Xrechnung" and `vibefinanceuk@gmail.com`).
