# 0564: Retiring a mapping: the missing proxy path, buttons top right, a pop-out

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-ui` and `vf-licence`, and needs **`vf-licence` migration
`0215`**. There is no `vf-app` change, and no `vf-app` migration.

## What was asked

After deploying 0563, Dan reported three things on the mapping editor's
Mapping card, with a screenshot:

- Its buttons sat below the fields. He asked for them at the top right,
  like every other card.
- Retiring was confirmed inline. He asked for a pop-out with **Retire
  Mapping** or **Cancel**.
- Retiring failed with "not found".

## What was found

The "not found" came from `vf-ui`, not `vf-app`. The `vf-ui` proxy
allowlist (`src/index.ts`) passes only the paths it names, and 0563 added
`/supplier-mappings/:id/retire` to `vf-app` without adding it there.

The standing rule is that a new path goes into both the allowlist and
`test/index.test.ts`. It was missed here, and no test caught it:

- the `vf-app` tests call the router directly;
- the browser tests stub `fetch`.

## What was decided

- **The proxy** now allows `retire`. The `vf-ui` worker test that lists
  every proxied path now includes it, and fails against 0563's allowlist.
- **Buttons:** **Save** and **Retire this mapping** sit in the Mapping
  card's head, top right, as on the editor's main card and elsewhere. A
  retired mapping shows neither.
- **Confirmation** is a pop-out, built the same way as the ERP export's
  Undo: a backdrop, a `popout` with `role="dialog"`, and its buttons in the
  head. It has:
  - the title **Retire mapping**;
  - **Retire mapping** and **Cancel**;
  - the same explanation as 0563: a live mapping stops reading invoices,
    and a draft affects none.

  Cancel, Escape or a click outside closes it. A refusal is shown inside
  the pop-out, not behind it. On success it closes, and Routes shows
  "… is retired."

  The inline confirmation from 0563, and its `.meretire` style, are gone.
- **Strings** are in `vf-licence` `0215`:
  - a new key, `mapping.retiretitle`;
  - `mapping.retireyes` updated to "Retire mapping" (de "Zuordnung
    stilllegen");
  - `mapping.retireno` updated to "Cancel" (de "Abbrechen").

## Verification

- **`vf-ui`** `test/index.test.ts`: the retire path is proxied. It fails
  on 0563's allowlist and passes now. Worker tests: 75 of 75.
- **`vf-ui`** browser `mapping-editor.test.ts`, with four new or rewritten
  tests. All fail against 0563's interface:
  - Save and Retire are in the Mapping card's head;
  - the pop-out's title, text and buttons; Cancel closes it without a
    call; Retire mapping posts, closes it, and Routes shows the notice;
  - a refusal is shown inside the pop-out, and Escape closes it;
  - the live-mapping warning appears in the pop-out.

  The test's string loader now also applies `UPDATE` statements, so it
  reads the words as they are live. Full browser suite: 1359 of 1360 pass.
  The one failure is the known `typography.test.ts` 10px gap.
- **`vf-licence`**: 322 of 322 pass, with `0215` loaded and the new key
  covered.
- **Migrations**: `vf-licence` replays 215.
- **Screenshot** of the pop-out over the editor, checked by eye. The
  Mapping card's buttons are at the top right.
