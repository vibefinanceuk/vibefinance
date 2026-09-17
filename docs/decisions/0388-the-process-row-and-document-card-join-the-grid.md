# 0388 — The process row and Document card join the grid

**Status: built.**

---

## What was asked

In two messages, each mocked up before it was built:

> Would it be possible to change the width of the process flow at the
> top of the invoice viewer page, so that it is equal width to the
> combined width of the Seller and Buyer cards. This would leave a
> space on the right, so that the document card can move up, with
> it's top being the same level as the top of the process card? Could
> you mock-up so that we can agree how that looks?

And, once that was agreed:

> The bottom of the Document image card should align with the bottom
> of the invoice header card. This will allow the invoice line item
> card to extend full width across the remainder of the page to the
> right. For now, can we hide the Exceptions card, but without
> removing the code, just the visibility.

---

## Mocked up before either landed

Both asks were rendered against a realistic fixture — a headless
Chromium loading the real `viewer.js`/`app.css` through a temporary,
untracked `harness.html` (deleted before every commit, per this
project's own established practice for decision 0386's measurements)
— and sent as screenshots before either was built for real, the
operator's own explicit request the first time and the natural next
step the second. Both were approved as shown before a line of
production code changed for the second request; the first had already
been approved in the prior turn.

---

## What was built

**The process row moved into the grid, not just narrowed.** A
`.panel` sibling sitting above `.columns` can only ever be as wide as
the page; there is no CSS width to give it that equals "whatever the
left column happens to be" except by *being* content of that column.
`progressRow()` still builds the same element; it is called inside the
grid now, in its own named area, rather than before it.

**Named grid areas, not two independent stacks.** The second ask —
the Document card's bottom landing on the header card's bottom, and
Lines running full width — cannot be done by two blocks that each
just flow their own children top to bottom, which is all `.columns`
had ever needed to be until now. `#viewer .columns` now carries:

```css
grid-template-areas:
  "process  document"
  "parties  document"
  "header   document"
  "lines    lines"
  "note     note";
```

`document` named in three rows is what makes the Document card's own
grid area exactly as tall as `process` + `parties` + `header` are,
however tall that turns out to be — not a guess at a pixel figure.
`lines` and `note` name the *same* area across both column tracks,
which is what lets a normally-left-column-only panel run under the
Document column too.

**The Document card fills that area rather than floating inside it,
the same flex chain decision 0386 already built for the pop-out.**
`.vpreview`'s own `height: calc(100vh - 300px)` was a real measurement
against this app's topbar and tabs, on the assumption that this card's
own height is "whatever is left below that chrome." That assumption
broke the moment the card's height became "as tall as three rows on
the other side of the grid" instead — a second guessed constant here
would have repeated exactly the mistake decision 0380 already warned
against. `.c-document > .panel:not(.exceptions)` gets `height: 100%;
display: flex; flex-direction: column`, its own non-`.cardhead`
children get `flex: 1`, and `.vpreview` resets to `height: auto` —
the card fills whatever the grid actually gives it and moves if that
changes, rather than encoding a number.

**`:not(.exceptions)` is load-bearing, not decoration.**
`exceptionPanel()` still renders inside the same grid cell as
`documentPanel()` and still carries the base `.panel` class. Without
the exclusion, `.c-document > .panel`'s own specificity (two classes)
beats the `.exceptions { display: none }` rule below it (one class)
regardless of which comes first in the file — found by watching the
mock-up render it anyway, not reasoned out in advance.

**Exceptions hidden, not removed — the operator's own words.**
`exceptionPanel()` and `renderExceptions()` are completely untouched;
`.exceptions { display: none; }` is the entire change, and deleting
that one rule is the entire way back.

**The shared `.columns` class stays shared, decision 0177's whole
point.** `sources.js` uses the same class name for its own, unrelated
two-panel layout, and a bare `.columns` rule carrying named areas
would have reached it too — every child there is unnamed, so it would
have been auto-placed into new implicit rows *after* the five named
ones, pushing the Sources screen's real content down by four empty
gapped rows. Checked, not assumed: rendered a synthetic page with
`#shell .columns` (Sources' own scope) beside `#viewer .columns` and
read both back with `getComputedStyle` — `#shell .columns` reads
`grid-template-areas: none; align-items: start` exactly as before;
only `#viewer .columns` carries the areas and `align-items: stretch`.
Every new rule this decision adds is scoped under `#viewer`, or under
a class (`.c-process` and its siblings) that exists nowhere outside
this screen.

**A panel's own bottom margin, once redundant, zeroed rather than
left to double up.** Decision 0178 gave every `.panel` a bottom margin
for sitting in a plain stack; each of `.c-parties`, `.c-header`,
`.c-lines` now holds exactly one such panel as the only thing in its
own named row, spaced from the next row by the grid's own 16px `gap`
instead. Left alone, the two would have added rather than replaced
each other.

**The narrow-screen collapse stayed correct for both screens without
being copied.** The pre-existing `.columns { grid-template-columns:
minmax(0, 1fr); }` under `@media (max-width: 1100px)` already
collapsed Sources to one column and needs no change. A second,
`#viewer`-scoped rule in the same media query adds the matching
single-column `grid-template-areas` for the viewer alone — the ID
wins regardless of which rule comes first, so nothing needed removing
from the shared one.

**Split into two `@media (max-width: 1100px)` blocks, not one.**
Decision 0281's own test slices this stylesheet by counting closing
braces from the *first* occurrence of that query string, looking for
`.nav`'s `position: static`. Every rule this decision would have
added ahead of `.nav` inside that same block pushed what the test was
actually checking out the far end of its own slice — watched fail
first, then fixed not by shortening a comment (decision 0387's own
fix for a similar collision) but by giving this decision's rules a
second block of their own, placed *after* the one the test depends on
rather than before it, so the first occurrence in the file is still
the one the test expects.

---

## Tests

CSS and markup only; no existing test asserted on `.columns`'s
previous plain-stack shape in a way this decision's own reasoning
didn't already check by other means:

- `typography.test.ts`'s `"keeps .columns as a grid"` still passes —
  `display: grid` is still the first thing the base rule says.
- `sources.test.ts`'s check that `.columns` exists on that screen is
  unaffected — the element is still there, still a plain grid, per
  the synthetic-page check above (not itself an automated test, kept
  as a documented manual check the way decision 0386's Chromium
  measurements were).
- Decision 0281's own nav test needed the two-block split above to
  keep passing, watched fail first against the single merged block,
  then confirmed passing after the split.

Full suites: vf-ui 74 Worker + 665 browser, both passing; `eslint`
clean. Pixel-measured in a headless Chromium against a realistic
fixture (long supplier name, long country name, a five-stage
process): header card and Document card both end at `768.33px`,
identical to the fourth decimal, and `.exceptions` computes to
`display: none`. Measured against the real, production `viewer.js`
and `app.css` after building, not only against the mock-up — the two
were confirmed pixel-identical.

---

## What is not built

Whether the space now empty to the right of the process row should
hold something, rather than sit empty — raised as an open question
after the first mock-up and not yet answered.
