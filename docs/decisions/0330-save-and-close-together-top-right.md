# 0330 — Save and Close, together, top right

**Status: built. Supersedes part of decision 0329.**

---

## What was asked

> I wanted save and close button in the top right. I apologise if I
> was not clear. I wanted the same as the supplier pop-out on the
> supplier page. see attached with save and close buttons

Sent after seeing decision 0329 live: the close icon had moved to the
top right correctly, but Save, Create, and Assign stayed as a
separate, standalone button at the bottom of the form — decision
0329's own reading of "relocate the icons" moved only the one that
was already an icon, not the pairing the operator actually meant.

## What was found

The exact, complete pattern already existed, in this same codebase,
under a decision number of its own: `suppliers.js`'s own edit popout,
per decision 0306 — *"Release Hold and De-activate buttons... to the
top right of the pop-out"* — puts every action that touches the
record, including Save and Close together, in one `.statebuttons` row
inside `.cardhead`, title left, actions right. Decision 0329 built a
version of the right idea without checking whether a more complete
one already existed two files over.

## What was built

Every write popout on the Roles screen now matches `suppliers.js`'s
own shape exactly: `.cardhead` holds the title and a `.statebuttons`
row with both the primary action and Close, each `actionLink`, each
with its own icon and visible label — not the icon-only close button
0329 introduced. The bottom-of-form standalone button is gone
entirely.

- **Role popout**: Save (its own dedicated icon) or Create, plus
  Close.
- **Assignments popout**: Assign, plus Close.
- **New-person popout**: Create, plus Close.
- **The one-time key view**: Done alone — no Close beside it, since
  dismissing that view without acknowledging the key was never the
  intended way out, and adding a Close here would have reopened
  exactly the accidental-dismiss risk decision 0328 built this view
  to avoid.

Two new `action.*` strings (`action.create`, `action.assign`) plus
`action.done`, added because `actionLink` ties one name to both its
icon and its visible label, and the existing `roles.create` /
`roles.assign` / `roles.done` strings from decisions 0326–0328 were
written as plain button text, never through `actionLink`, so they
could not serve this. Two new icons (`create`, `assign`), each
deliberately reusing an existing glyph (`save`'s and `complete`'s,
respectively) under a new name — the same "same shape, different
name because `actionLink` needs one per label" reasoning `newperson`
already established reusing `newsupplier`.

## What has coverage

The four tests decision 0329 wrote to check the wrong layout were
rewritten to check the corrected one — now asserting both actions sit
together in the header, each with an icon, and that nothing remains
at the bottom of the popout. A fifth test added for the one-time key
view specifically: Done alone, nothing else beside it. Two
pre-existing tests broke because they queried a button by scoping
logic that assumed the old, one-action-per-location layout, or by a
"Close" text match that the old icon-only button (0329's own design)
would have failed on the *first* pass, had a test ever checked for it
directly — fixed to query what is actually now on screen, not
loosened.

Probed directly: moving `stateButtons` back outside `.cardhead` for
the role popout failed exactly the test built to catch it.

`vf-ui`: 56 Worker (unchanged), 459 browser (was 454 before decision
0329, 458 after it, 459 now). No backend change.
