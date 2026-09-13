# 0298 — Actions leave the footer: Expand to the tabs, everything else to the topbar

**Status: built.**

---

## What was asked

> 1) In the Document Viewer, move Expand button, to the top right of
> the Document image - to the right of the Document, and Timeline /
> Chat tabs. 2) Move Save, Complete, Release and Return buttons to the
> top right of the page, next to the Back button. This will free space
> below the document image, which can be reclaimed.

Two different destinations for two different kinds of action, and the
split in the request matches a real distinction: Expand is about the
document itself, and stays with it; Save and the task's own actions
are about the task, and moved to sit beside the one button that was
already there for exactly that reason — leaving the task.

## Expand — top right of the document's own tabs

`documentPanel()`'s own `.doctabs` row (Document, Timeline / Chat, XML
when there is one) used to render on its own. It now shares a
`.cardhead` row with Expand on the right — the same title-left,
action-right shape `.cardhead` already gives the Seller card's Change
Seller and the Invoice header card's Header Fields, reused rather than
inventing a new layout for a fourth case of the same pattern.

## Save, Complete, Release, Return — the topbar, beside Back

These moved into `topbar()`'s own `right` array, alongside the Back
button decision 0284 already put there. The complication: `topbar()`
is called earlier in the render than `documentPanel()` was, and the
button-building logic used to live entirely inside
`documentPanel()`'s own `actionsRow`. Extracted into its own function,
`taskActionButtons(task, onClose)`, called once from where `topbar()`
is invoked — not duplicated, and not left somewhere only one of the
two call sites could reach.

**The footer row is gone, not merely emptied.** `documentPanel()` no
longer builds an `actionsRow` at all — `docPane` renders directly as
each tab's own pane, with nothing wrapping it. This is what actually
frees the space the operator asked for, rather than leaving an empty
row that still reserves it.

## What has coverage

The two tests decision 0122 originally wrote for the old footer row
tested a placement this change deliberately reverses, so both needed
real changes, not just relocation: one now confirms Save and the
task's own actions render inside `.topbar .right`, alongside Back, and
that no `.actionrow` remains anywhere beneath the document; a second,
new test confirms Expand specifically renders inside the `.cardhead`
wrapping `.doctabs`, and is absent from the topbar's own right-hand
section — proving the two destinations are actually distinct, not
that everything landed in the same place by coincidence. A third,
unrelated test broke as a side effect of removing the `#vpreview`
wrapper div (decision 0271's own "not visible under the image" check
depended on its exact shape) and was rewritten to check the same
underlying claim — the system alert isn't visible while the Document
tab is active — against the tab's own `hidden` state instead of a
container that no longer exists. Each of the two new claims probed
directly: removing `taskActionButtons()` from the topbar, and removing
Expand from `.cardhead`, each failed exactly the test written for it.

vf-ui: 49 Worker, 372 browser. No migration.
