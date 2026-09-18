# 0394 — A column, two arrows, and a marker

**Status: built, not yet pushed.** Three requests evaluated together,
mocked up before anything was built, and scoped individually per the
operator's own choices below.

---

## What was asked

An evaluation request, not a build order:

> Please can you evaluate adding some new capabilities to the document
> image viewer. This would include 1) Show the Timeline / Chat as a
> displayed panel running on the right of the invoice image, when
> expanded in the separate window only. The expanded window has the
> space to facilitate both the invoice image and the timeline / chat
> in the same window. the timeline / chat should appear on the right
> of the invoice image, approximately 20% or 25% width of available
> space. 2) would it be possible to add next / previous page cycling
> on the top of the document image viewer to the right of the rotate
> icon? 3) Would it be possible to add annotation capabilities to
> highlight areas of the document using annotation controls?

---

## The premise, checked before building anything

A Playwright harness mounted the real pop-out window
(`document-window.html`) against a realistic multi-page fixture and a
populated Timeline / Chat feed, then mocked each proposal directly
against the rendered DOM — the same discipline this session has used
for every layout question, "measure, don't assume."

**Part 1 was genuinely open** — a straightforward restructure, not a
straightforward width. `document-window.html` and the embedded
validation-screen card both call the same `buildDocTabs()` (decision
0384, deliberately: "a pop-out that rendered its own idea of the
Document/XML/Timeline-Chat tabs could drift from what Expand
promised to open"), so the standing side column had to be built
entirely in `initDocumentWindow()`'s own layout code, never inside
that shared function, or the embedded card would have inherited it
too. `activity.js`'s own pane (`buildActivityTab()`) turned out to be
unconditionally self-contained — it redraws the exact node it was
given regardless of whether that node is a hidden tab pane or a
standing column — so nothing there needed to change at all.

**Part 2 turned out to already be mostly built.** The thumbnail rail
(`page-renderer.js`, decision 0382) already tracks `pages`, `current`
and a `selectPage()` — the rail is simply a second way to reach it.
Previous/next needed two more buttons calling the same function nothing else.

**Part 3 had no prior art anywhere in the codebase** — no schema, no
overlay layer, nothing. Genuinely the largest of the three, so it was
mocked only illustratively (a static box, not wired to anything) before
asking how far to take it.

Three mockups were shown, and the operator chose directly:

- **25%**, not 20%, for the Timeline / Chat column.
- **Both** the pop-out and the embedded card get page cycling — the
  controls row is one shared piece of code between them, and
  special-casing it to appear in only one would have been the extra
  work, not the default.
- Annotations: **build a small first cut now** — session-only
  rectangle highlights — rather than scoping the full feature first or
  holding it for later.

---

## What was built

### Part 1 — Timeline / Chat as a standing column, pop-out only

`initDocumentWindow()` pulls the `timeline` entry out of
`buildDocTabs()`'s own `tabs` array before rendering: its button is
left out of the `.doctabs` row entirely (nothing to switch to, because
nothing hides it), and its pane's `hidden` is forced `false`
immediately. The remaining entries (Document, and XML for a hybrid
PDF) go in a `.docwindowsplitleft` column at 75%; the timeline pane
goes in a `.docwindowsplitright` column at 25%, `.docwindowsplit`
holding the two side by side.

**The one real trap, caught before it shipped**: `buildDocTabs()`'s own
`select()` closure loops over *every* entry it built when a tab
button is clicked — Document included — hiding whichever key was not
the one just selected. With the timeline button gone from the row that
closure is never asked to select `"timeline"`, but clicking Document or
XML still runs it, and it would still set the timeline pane's `hidden`
back to `true` as a side effect, since it doesn't know the pop-out
stopped treating it as a tab. Each remaining button's own `onclick` is
wrapped — call `buildDocTabs()`'s own handler, then force the timeline
pane visible again — the one place this function reaches back into what
the shared closure did, rather than working around it by copying or
modifying `buildDocTabs()` itself.

Below 900px (the same "too narrow for side-by-side" width this
stylesheet already uses for `.supplierhead`/`.poloadhead`), the split
stacks instead of squeezing to a sliver: Timeline / Chat moves beneath
the document, capped at 40% of the window's height with its own
scroll.

### Part 2 — Previous / next page cycling

Two more buttons in `.vcontrols`, to the right of Rotate, calling the
existing `selectPage(current - 1)` / `selectPage(current + 1)` —
nothing new tracks "which page," the thumbnail rail's own state does,
same as it always has. Icons reuse `chevronleft`/`chevronright`,
already drawn for Purchase Orders' and Suppliers' own pagination
(decision 0376) rather than a second pair of arrows. Disabled at each
end, the same pattern the zoom buttons already use. Lands in the
shared control row, so it appears both in the pop-out and, per the
operator's own choice, the embedded validation-screen card.

### Part 3 — The highlight tool, a small first cut

A new toggle button (`Highlight`, a new icon) in the same control row.
Toggling it on turns a drag on the canvas into drawing a rectangle
instead of panning; toggling it off returns to panning exactly as
before. Deliberately scoped down from "annotations":

- **Session-only.** Nothing is sent anywhere or outlives the window
  being closed. No schema, no API route, no new tables — the honest
  boundary given the size of the real (persisted, shared) version.
- **One shape.** A dragged rectangle, nothing else.
- **Recorded as a fraction of the canvas's own rendered box**, not of
  the underlying page image. `drawRotated()` (decision 0382) always
  resizes the canvas bitmap to exactly the scaled, rotated image with
  no letterboxing, so that box *is* the image at every zoom step — a
  stored fraction of it stays correct across zoom precisely because
  zoom only ever scales that box, never reshapes it.
- **Cleared on rotation and on page change.** Rotation reshapes the
  box itself (width and height swap), so a fraction that meant
  "top-left corner" a moment ago would land somewhere unrelated once
  the page turns; a page change means the highlight belongs to
  different content entirely. Both are stated limits, not bugs quietly
  worked around.
- **A short drag removes**, rather than adding a highlight nobody could
  see or select again — the same gesture, read by its own size
  (`MIN_DRAG`), doubles as "click to remove."

---

## Tests

Ten new tests, all watched to fail against the pre-fix code first
(`git stash` on `app.css`/`icons.js`/`page-renderer.js`/`viewer.js`,
test edits kept, rerun, confirmed genuine failures, `git stash pop`):

**`document-window.test.ts`** (three): Document is still a tab and
Timeline / Chat is not (corrected from the older, now-wrong assertion
that it was); the split itself — `.docwindowsplitleft` holds `#vpreview`,
`.docwindowsplitright` holds a visible `.docwindowtimeline`; switching
to the XML tab leaves the timeline column visible rather than letting
the shared `select()` closure re-hide it, the specific trap described
above.

**`page-renderer.test.ts`** (seven): previous/next move through pages,
moving the rail's own selection and disabling at each end, reusing
`selectPage()` (proven by the rail moving too, not a second
mechanism); a single page disables both from the start; the highlight
tool toggles the button and the holder's cursor class; a drag with it
on draws a box sized as the correct fraction of the canvas; a short
drag (a click) removes the highlight under it instead of adding a
zero-size one; rotating clears highlights; changing page clears
highlights; with the tool off, a drag still pans exactly as decision
0392 left it.

`canvas.getBoundingClientRect()` is stubbed directly in the highlight
tests — jsdom (decision 0121) always reports a zero-size box for it,
same reason it has no working canvas 2D context, and the highlight
math needs a real box to divide by. What is tested is the
orchestration (mode toggling, which drag becomes a highlight, when the
set clears); the actual pixel-for-pixel positioning on screen was
checked by the Playwright mockup above, not by this suite — the same
split this file's own header comment already draws for zoom and
rotation.

Migration 0123 (`vf-licence`) seeds `viewer.previouspage`,
`viewer.nextpage` and `viewer.highlight` in `en`/`de`; wired into
`vf-licence/test/setup.ts`'s own migration chain, and into
`string-coverage.test.ts`'s hand-maintained key list, the same as
every string-bearing decision before it. `viewer.previouspage`/
`viewer.nextpage` reuse decision 0376's own English wording exactly
("Previous page"/"Next page") rather than viewer-specific phrasing.

Full suites: vf-ui 74 Worker + 684 browser (674 pre-existing + 10
new), both passing; vf-licence 320/320. `eslint` clean.
`scripts/check-citations.py` clean once this record existed to answer
it. Touches `vf-ui` (`app.css`, `icons.js`, `page-renderer.js`,
`viewer.js`) and `vf-licence` (migration 0123 + `test/setup.ts` +
`test/string-coverage.test.ts`) only — no change to `vf-app` or
`vf-admin`.

---

## What is not built

Everything the "small first cut" scoping deliberately left out of
annotations: persistence (a highlight is gone the moment the window
closes), any shape but a rectangle, surviving a rotation or a page
change, showing up in the Timeline as an activity item, and any
multi-user visibility question (who sees a highlight, and whether it
is "internal only" the way comments already are). None of these were
ruled out — they were the difference between a first cut and the full
feature, and the operator chose the first cut.

Whether 25% still reads well at window sizes far from the ones
measured (1600×950 and a narrower 1180×820, plus the 900px-and-below
stacked fallback) — not checked beyond those three points.

Page cycling was not evaluated against a very long page count (the
mockups and tests used three pages); the rail itself already handles
this today and was not changed.
