# 0392 — More room in every direction

**Status: built, not yet pushed.** This session has no push access to
`origin/main`; delivered as a bundle for the operator's own
pull/push/deploy sequence, same as every prior decision here.

---

## What was asked

> can you investigate - 1) is it possible to zoom into the image
> closer than max width. The zoom in facility seems to stop working
> at max width. 2) When expanded, the original window still shows a
> card for the invoice image, but this space is no longer used. The
> ideal solution would be to reclaim the space where the image used
> to be. The Seller card, buyer card and Invoice Header card can all
> occupy the same row. 3) The invoice lines will have much more space
> to grow further down the page, simplifying invoice validation,
> entry and correction. 4) The Document card controls that appear -
> "Expand", "Bring to Front" and "Show here instead" could occupy a
> much smaller card in the same space, leaving room for the invoice
> header card. Could you comment on feasibility and mockup

Followed, once mockups and a feasibility answer on the zoom question
were presented, by:

> I think Seller and Buyer cards contain less content that Header.
> Therefore Header should occupy more of the screen space width. I
> would estimate 25%/25%/50%, or 30%/30%/40% would be suitable width
> ratio for the Seller/Buyer/Header cards. On the zoom, I'm not sure I
> understand, but I think the user will want to zoom into the image
> detail past max width. Then use the mouse pointer to drag around the
> page, or scroll up and down and across as needed.

The width ratio was then settled directly: both 25/25/50 and 30/30/40
were mocked up and measured, presented side by side, and 25/25/50 was
chosen.

---

## Part 1 — the zoom control was never actually stuck

Reproduced before touching anything: each zoom click *does* redraw the
canvas at a genuinely larger pixel resolution (measured 1000 → 1250 →
1500 → 2000 → 3000px across five clicks on one test image) — the
control itself was working. What stops was the **CSS box** showing it:
`.vcanvas { max-width: 100%; }` clamps the element's *display* width
to its holder's width at every zoom level, regardless of the canvas's
real pixel size, and most scanned invoices are already wider than the
card even unzoomed, so every further click bought resolution the
screen never showed any more of.

**Built:** `.vcanvas` only gets the clamp lifted once genuinely zoomed
in past the default step — `zoomedIn = zoomIndex > DEFAULT_ZOOM_INDEX`,
toggled as a `.zoomedin` class on the canvas inside `draw()`, paired
with `max-width: none` for that class alone. Below the default step,
nothing changes: the existing "fit the frame" behaviour is exactly
what a not-yet-zoomed image should do.

**Panning, asked for in the same message ("drag around the page, or
scroll... as needed"):** `.vcanvasholder { overflow: auto; }` already
gives scrolling for free once the box can genuinely exceed its frame.
Drag-to-pan needed building: `pointerdown`/`pointermove`/`pointerup`/
`pointercancel` listeners on the holder, moving `scrollLeft`/`scrollTop`
by the pointer's own delta since the drag started. **Pointer capture
(`setPointerCapture`), not `window`-level mouse listeners** — chosen
because `pageViewer()` is called fresh per opened document with no
explicit teardown (decision 0382's own design), so a pair of `window`
listeners would leak one more copy every time a document is opened;
pointer capture self-releases on `pointerup`/`pointercancel` and never
touches `window`. Guarded with `canvasHolder.setPointerCapture?.(...)`
since jsdom (decision 0121) has no such method. A `.pannable` class on
the holder (same `zoomedIn` condition) swaps the cursor to a grab hand,
and `.dragging` (toggled for the drag's own duration) swaps it to
grabbing.

## Part 2 — reclaiming the Document card's row

Decision 0391 stopped the Document card from *growing* the row it sits
in; this decision asks it to stop *occupying* that row's space at all
once popped out, since nothing needs to be drawn there any more.

**Two more complex approaches were tried, measured, and rejected
before the one that shipped:**

- **Equal-thirds plus a dedicated placeholder row** — merging Header
  into a three-way equal split saved roughly 62px, but giving the
  shrunk placeholder a new row of its own cost about 50px straight
  back, landing Lines barely different (in one case *worse*: 738px vs
  a 718px baseline).
- **Moving Header's own DOM node into the Parties container via
  JavaScript** — worked, but was more code than the alternative below
  for an identical result (measured Lines at 521px against the
  eventual approach's 520px).

**What shipped: zero DOM moves.** `.c-header` stays exactly where it
has always lived, as `.c-parties`'s sibling. A `docpoppedout` class on
`.columns` (toggled by `viewer.js`, entirely via CSS) changes
`grid-template-areas` so `parties` and `header` share one row, with
`parties` spanning only two of the row's three column tracks — its own
pre-existing internal grid (`auto-fit, minmax(260px, 1fr)`, splitting
Seller from Buyer automatically) does the rest. The freed placeholder
shares the Process row's own line via a slim extra column, costing no
additional row height at all — the same trick that made the
equal-thirds attempt fail is exactly what this version avoids.
`.c-document` resets to `position: static; height: auto;` while
popped out, since decision 0391's `position: absolute` sizing trick
is for the *docked* case only.

**The ratio, measured both ways before asking:**

| | 25/25/50 | 30/30/40 |
|---|---|---|
| Header's own internal grid | keeps its natural column count | drops to fewer columns, growing taller (350px vs 258px) |
| Lines card lands at | **520px** | 613px |

30/30/40 gives Header less room than it needs for its own natural
layout, so it grows *taller* instead — the opposite of what more width
was meant to do. Presented both, measured; **25%/25%/50% was chosen.**

**Built:** `#viewer .columns.docpoppedout` — `grid-template-columns:
minmax(0,1fr) minmax(0,1fr) minmax(0,2fr)` (25/25/50, since two equal
`1fr` tracks against one `2fr` track is exactly a 1:1:2 ratio) —
`grid-template-areas: "process process document" / "parties parties
header" / "lines lines lines" / "note note note"`.

**A CSS specificity bug caught before it shipped, not after.**
`#viewer .columns.docpoppedout` (ID + 2 classes) outranks the plain
narrow-screen `#viewer .columns` rule (ID + 1 class) *regardless* of
which `@media` block either lives in — so an unscoped wide-mode
`.docpoppedout` rule would have kept winning even inside the existing
narrow `@media (max-width: 1100px)` block. Reproduced deliberately
first (a mockup run "without the reset", showing the narrow columns
cramped to 424px) before writing the fix: an equally-specific
`#viewer .columns.docpoppedout` reset *inside* that same media query,
restoring the plain single-column stack for narrow screens.

## Part 3 — the placeholder shrinks to a badge

The pop-out placeholder ("Open in a separate window" / "Bring to
front" / "Show here instead") filled the whole Document card before
this decision; now that the card gives that space back, the
placeholder becomes a small corner badge instead — a thumbnail,
one line of text, and the three action links, laid out in a single
row rather than a filled box (`.vthumb`, `.vpoppedouttext`,
`.vpoppedoutactions`, `.actionlink` all switched to a slim flex row,
right-aligned, no min-width or filling padding).

An initially-copied `#viewer .columns.docpoppedout .c-header {
display: block; }` reset was found unnecessary — nothing ever sets
`.c-header` to `display: none` — and dropped rather than kept "just in
case".

## A construction detail worth recording

`documentPanel(task)` calls its own `popoutStateSetter(popoutIsOpen())`
synchronously, during construction. Passing it a callback that
references `.columns`'s own element (`columnsEl`) would hit the
temporal dead zone if `columnsEl` were still being built in the same
single `const columnsEl = el(..., [...])` expression that constructs
`documentPanel` as one of its children. Fixed by declaring `columnsEl`
empty first, then `.append()`-ing its children — including
`documentPanel(task, setDocPoppedOut)` — in a later statement.

---

## Verification against the real code, not mockups alone

Every number above came from mockups; the final numbers were then
re-measured against the *actual* production code path — clicking the
real `Expand` button, stubbing `window.open` the way the real test
suite's `fakeWindow()` does — at both 1400px and 900px viewports, and
through a full open → reflow → close cycle:

- Popped out, wide: `docpoppedout` present, Lines at **520px**.
- Popped out, narrow (900px): the reset applies, columns full-width
  single-column, no cramping.
- **Closed again ("Show here instead"), wide:** layout restored to
  *exactly* the pre-Expand baseline — process 72px/679px, document
  562px/453px, lines at 718px, matching the un-popped-out numbers
  precisely. (The first pass at this check used a fake `window.open`
  handle whose `close()` was a no-op, so `handle.closed` never became
  `true` and the real 700ms `watchPopout()` poll never fired — a bug
  in the verification script, not in `viewer.js`. Fixed by making the
  fake `close()` actually set `closed = true`, matching a real
  browser window, and waiting past the poll interval.)

## Tests

Three new tests, each watched to fail against the pre-fix code first
(`git stash` on the three production files, test edits kept, rerun,
confirmed clear assertion failures, `git stash pop`):

- `page-renderer.test.ts` — the canvas is marked `.zoomedin` (and the
  holder `.pannable`) only once zoomed in past the default step, and
  both clear on zooming back out.
- `page-renderer.test.ts` — a synthetic drag (`pointerdown` at
  `(200,150)`, `pointermove` to `(140,100)`) moves the holder's own
  `scrollLeft`/`scrollTop` by exactly the pointer's delta (60, 50), and
  stops tracking after `pointerup`.
- `viewer.test.ts` — `.columns` gains `docpoppedout` on Expand and
  loses it again on the same open/close cycle the existing placeholder
  test already covers, driven by a fake window whose `close()` sets
  `closed = true` (the real-window shape, not the no-op the manual
  verification script briefly got wrong).

Full suites rerun clean: **Worker 74/74; Browser 18 test files, 669/669
tests** (666 pre-existing + 3 new). 153 unhandled-rejection console
errors (152 pre-existing "no stub for /api/documents/inv-1/activity"
noise + 1 new instance of the same known class from the new pop-out
test, not stubbing that endpoint either — consistent with the
established, tolerated pattern, not a regression). Touches `vf-ui`
only (`app.css`, `page-renderer.js`, `viewer.js`), no migration, no
other Worker.

## What is not built

Pinch-to-zoom or wheel-based zoom — the zoom control asked about here
is the existing button-stepped one; a gesture-driven zoom was not part
of the request and was not investigated.

Persisting the popped-out/docked state across a page reload — it
resets to docked, as it always has, and nothing about this decision
changes that.
