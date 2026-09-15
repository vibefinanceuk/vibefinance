# 0347 — Icons on Sources: Rename, Retire, and Create

**Status: built.** "Please can you update the Sources screen to
include icons for the Rename and Retire buttons? Also, please can you
update the Create button, to have an icon and appear in the top right
of the 'Add a source' card?"

---

## What changed

**Rename and Retire** were plain, unlabelled-by-icon `<button>`
elements. Both now use `actionLink`, the same icon-and-label button
every other write action in this app already uses — replacing two
one-off buttons with the established pattern rather than adding a
third way to draw an action button.

Two new icons, each chosen for what the action actually does rather
than reused from something adjacent in meaning: a pencil for Rename,
since renaming genuinely edits a value — the same reasoning this
project already gave for why `changebuyer`/`changeseller` are
deliberately *not* a pencil (they replace one record with another,
they don't edit a value); an archive box for Retire, distinct from
`close`'s own X shape, since retiring a source is neither deleting it
(a real, named distinction this screen's own code already draws) nor
dismissing something — it is put away, kept, no longer active.

**Create** moved from a `<button>` at the bottom of the "Add a
source" form into the card's own header, top right, beside the
heading — the same `.cardhead` shape every other write action's own
header already uses elsewhere in this app (an org unit's own create
form, a team's own, a person's own). It keeps `class="primary"` and
its own click handler exactly as before; only where it sits, and that
it now carries an icon, changed.

## What has coverage

Two new tests: Rename and Retire each carry a real `<svg>`, and Create
sits inside the card's own `.cardhead` — found by locating the header
that contains "Add a source" specifically, rather than any `.cardhead`
on the page — with its own icon, and is confirmed absent from the
form's own body where it used to live. Existing tests for creating a
source (refusing an empty name, posting to the chosen process) needed
no changes at all: they already found the button by `button.primary`,
which `actionLink`'s own class list still satisfies. Both new claims
were probed directly: moving Create back to the form's own bottom, and
reverting Rename/Retire to plain buttons, each failed exactly the test
built to catch it.

`vf-app`: unchanged (frontend-only). `vf-ui`: 63 Worker (unchanged),
504 browser (was 502).
