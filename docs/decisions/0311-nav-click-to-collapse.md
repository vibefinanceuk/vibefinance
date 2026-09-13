# 0311 — The nav is its own collapse toggle

**Status: built.**

---

## What was asked

> One UI change - please can you remove the collapse and expand
> button from the side menu. I would rather that the collapse and
> expand functionality happen when a user clicks on the side menu, if
> they do not select a button that redirects to another screen.
> Therefore any other area, than a highlighted button would clause the
> side menu to either collapse or expand.

## What was built

`navEl` — the `<nav>` element itself — now carries the click handler
decision 0274's own `.navcollapsetoggle` button used to. A single
guard, `e.target.closest(".navitem")`, tells a real navigation click
apart from everywhere else in the nav — the logo, `.who`, the empty
space the old button used to occupy — without needing
`stopPropagation()` added to every nav item individually; the check
lives once, on the parent, rather than repeated at every child.

**Decision 0274's own mechanism is unchanged, just relocated.**
Toggling the class directly rather than re-rendering, and persisting
the choice via `localStorage` the same way `mood.js` already does —
both carry over exactly, since neither reasoning depended on where the
click itself originated.

**Cursor affordances split deliberately.** `.nav` itself gets `cursor:
pointer` — the region as a whole is now clickable, the same signal
`tr.clickable` already gives a table row with no button of its own.
`.navitem` keeps its own, separate `cursor: pointer`, since a nav item
and the region around it are genuinely two different actions sharing
one area, and a person hovering one should not read it as the other.

**A real trade-off, not hidden**: the removed button carried an
explicit `aria-label` ("Collapse the menu" / "Expand the menu") and
was independently focusable and activatable by keyboard. A `<nav>`
with a click handler is neither, by default — this is the direct cost
of the request as asked, not an oversight, and worth a second look if
keyboard-only use of this control matters.

## What has coverage

Two existing tests referenced `.navcollapsetoggle` directly and were
rewritten: the toggle test now clicks `.nav` itself and drops the two
`aria-label` assertions the removed button no longer has anything to
carry; the "survives navigation" test needed no change beyond the
shared helper, since it never asserted on the label. A new test proves
the other half of the request directly — clicking a nav item navigates
and leaves the fold state untouched, rather than assuming the guard
works because the toggle test happened to pass. Both directions probed
independently: removing the click handler entirely fails the toggle
test; removing just the `.closest(".navitem")` guard fails only the
new navigation test, confirming each checks the behaviour it claims to
and not the other one by coincidence.

vf-ui: 49 Worker, 399 browser (was 398). No migration.
