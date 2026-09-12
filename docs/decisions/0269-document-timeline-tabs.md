# 0269 — The Document and Timeline / Chat tabs, built

**Status: built.** The mock-up and the tradeoff from decision 0268
confirmed; this is that work done for real.

---

## What changed

Decision 0267 shipped the activity panel as a drawer: hidden by
default, a small tab at the edge, opening into a strip below the
document preview. The operator's own picture was different — "two
tabs, reading 'Document' and 'Timeline / Chat'" — sharing the exact
space the preview has always occupied, not opening a second area
beneath it.

**The tradeoff named in the mock-up, confirmed rather than assumed
away**: the document and the conversation can no longer be visible at
once. Switching to read a comment hides the invoice itself for that
moment, which the drawer never required. Built anyway, on explicit
confirmation.

## Both panes stay mounted

Switching tabs toggles `hidden` on two already-built panes rather than
tearing one down and building the other. Two real reasons, not one:

- `showPreview()` fills `#vpreview` once, asynchronously, after the
  initial render. Rebuilding that element on every tab switch would
  discard whatever it had already loaded.
- The activity feed keeps its own state (`items`, `loading`, `error`)
  the same way the drawer version did. Rebuilding its container on
  every switch back to the tab would mean re-fetching every time.

Switching tabs therefore never calls `viewer.js`'s own full
re-render — it toggles two DOM nodes directly and updates two button
classes, nothing else.

## The tab now loads eagerly, not on first click

The drawer only fetched once opened — nothing to load if nobody looked.
A tab is different: "Timeline / Chat" sitting there with no number
until clicked once would be the tab lying about how much is behind it
for its entire first moment on screen. `buildActivityTab()` now starts
loading the moment the document opens, and the count badge — a live
node handed to `viewer.js` to embed in its own tab button — fills in
as soon as it resolves.

## A real bug, caught by the tests written for this

`el()`'s props take a `hidden` key through `setAttribute`, and
`setAttribute("hidden", undefined)` sets the literal attribute
`hidden="undefined"` — still present, still hiding the element,
regardless of the ternary's intent. The Document pane was built this
way at first and rendered hidden by default, the opposite of what was
wanted. Fixed by setting `.hidden` as a property after creation,
matching how the Timeline pane was already built.

**A second, quieter gap found by deliberately breaking the fix
afterward**: the first version of "shows the Document tab active by
default" only checked that the Document pane was visible, never that
the Timeline pane was actually hidden — a probe that broke the
visibility toggle entirely still passed it. Strengthened to check
both, then confirmed the same probe now fails it correctly.

## State per document, not a global toggle

`docPanelTab` resets to `"doc"` every time `openViewer()` runs for a
new document, mirroring `activity.js`'s own reset — arriving at a
second invoice must never show whichever tab the first one was left
on. Probed directly: removing the reset breaks exactly the test
written to guard it.

vf-ui: 49 Worker, 309 browser. vf-licence: 320 (one new string,
`activity.timelinetab`; the drawer's own `activity.tab` and
`activity.title` are left in the database, unused, per decision
0071's rule against removing a string in passing). `vf-app` untouched.
