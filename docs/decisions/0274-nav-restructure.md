# 0274 — Dashboard first, Vibe AP grouped, the nav foldable to icons

**Status: built.**

---

## What was asked

> 1) Rename "My work" as "Dashboard", and make first in the list.
> 2) Create a new Side Menu Item, as a Master, called "Vibe AP". This
> is simply an expandable menu under which all items within can
> expand (appear) and contract (disappear). 3) Create icons for each
> of the side menu items that exist... 4) Allow the side menu to the
> collapsable... show only a "V".

Four pieces, the largest restructuring of the nav since decisions 0145
and 0149.

---

## The V mark

The uploaded reference image had an opaque background — using it
directly would have shown a visible box around the mark rather than
letting it sit on the nav's own surface. **Cropped from the existing
logo instead**: the wordmark's own first letter is the identical
gradient chevron, so `logo-mark.png` is that same source, cropped,
rather than a second asset that could ever drift from the first.
Confirmed the crop caught nothing of the neighbouring "i" by rendering
several candidate widths and looking at each rather than trusting one
guess.

## Six icons, checked before they were kept

**Rendered and looked at, not just written.** Each SVG path was
rendered to a PNG and reviewed as a grid before being committed to
`icons.js` — the discipline this codebase already applies to code
applied here to shapes, since a path that compiles is not a path that
reads as the thing it claims to be.

**Chosen for recognition, not decoration**: Tasks is a checklist;
Dashboard is four unequal tiles, because decision 0244 already
established the real cards are never uniform and a grid of identical
squares would misdescribe the screen it represents; Sources is an
inbox tray; Suppliers is a building, deliberately not a person —
suppliers here are organisations, never individuals with faces;
Documents is the plainest possible page-with-a-corner, since this
screen holds every kind of document at once; Rules is a branch, not
`compile`'s lines-and-brackets — `compile` draws the *act* of writing
a rule, and a nav icon has to say what the *screen* is, which is nearer
to "one condition, two outcomes."

**The group needed its own icon too**, once a text badge was tried
first and rejected: a folder, since the group genuinely groups real
screens the way a folder groups files, and a badge would have been the
one thing on the bar that was not a drawn icon.

## The structure

`navLink()` builds one icon-and-label entry, used identically for
Dashboard at the top level and for each of the five screens nested
under the new "Vibe AP" group. The group's own header is a button, not
a link — it does not navigate anywhere, only opens and closes what is
beneath it — styled to match `.nav a` rather than inheriting it, since
a button carries none of a link's own defaults.

## Two settings, one existing pattern

Both the group's open/closed state and the whole nav's folded state
are **persisted exactly the way decision 0139 already persists day and
night**: a `localStorage` key, read with a fallback, written in a
`try`/`catch` that leaves the setting merely forgotten rather than the
nav broken if a browser refuses storage. No new persistence mechanism
was invented for a problem this app had already solved once.

**The group defaults open.** Collapsing five of the app's six real
screens on a person's first visit, before they had ever chosen to
close anything, would have hidden more than it revealed.

**Toggling is a class flip, not a re-render.** Every other piece of
nav state already lived as a DOM class a click could flip — which
screen is current, which entries show as `.on`. Folding the whole nav
is the same kind of change, so it toggles `.frame`'s own class
directly rather than rebuilding the screen underneath it. The class
lives on `.frame`, not `.nav`, because the collapsed nav needs a
narrower grid *column*, and only the grid's own container can say
that.

## What broke, and what it taught

**An old test's own fragility, exposed rather than caused.** A
dashboard chart test read `document.querySelectorAll("svg rect")` with
no scope at all — a query that used to be safe because nothing else on
the page drew a `<rect>`. The new nav icons draw several. This is the
identical class of fault decision 0257 already found once for an
unscoped `querySelector("svg")`; the fix here is the same one: scope
the query to the chart's own panel rather than the whole document.

**My own new test found the same lesson decision 0249 already
recorded.** A test written for this decision waited a fixed
`setTimeout(r, 0)` after clicking a nav link that triggers an async
screen change — enough for that one test to pass alone, and enough to
leave the navigation's own async chain still in flight when the test
finished, intermittently breaking whichever test ran next in the same
file. Found by running the full file three times and watching a
different, unrelated test fail once; fixed by polling for the real
condition (the new screen actually becoming current) instead of
guessing a duration. Confirmed by reverting the fix and watching the
failure reproduce twice in three runs, then reapplying it and running
clean five times in a row.

vf-ui: 49 Worker, 329 browser. vf-licence: 320.
