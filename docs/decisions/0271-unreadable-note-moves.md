# 0271 — The unreadable note moves, and the image gets its room

**Status: built.**

---

## What was asked

> Rather than display the message "This document could not be read
> automatically. Key the fields from the image on the right." under a
> document image, I would rather this information appeared in the
> "Timeline / Chat"... it should be removed from beneath the document
> image, to make room for the image. The Document image should be
> aligned with the base of the bottom of the screen.

---

## Where the note lives now

**A standing banner, not a feed item.** It says something about the
document's own state, not something that happened at a particular
time — no timestamp, nothing to sort alongside comments and stage
completions. It sits above the feed in the Timeline / Chat pane, the
same visual slot `activity.js`'s own error banner already occupies.

**A wrapper node, because `activity.js` owns its own content.**
`buildActivityTab()`'s returned `content` node has its children
replaced on every load, post, and error — appending the banner
directly into it would survive only until the eager load (decision
0269) finished and wiped it out. A new `timelinePane` wraps the banner
and `content` together; `viewer.js` toggles `timelinePane`'s own
`hidden`, and `activity.js` never learns the banner exists.

**`unreadableNote()` is gone, not just unused.** Its one call site was
removed along with it — dead implementation code, unlike a dead UI
string, is safe and correct to delete rather than leave for the next
reader to wonder about.

## The image's own room

`.vpreview` was a fixed 320px regardless of what else was on the page.
Now `calc(100vh - 300px)`, with `min-height: 320px` as the floor the
box already had — a real estimate of the chrome sharing its column
(topbar, tabs, this panel's own padding, the action row below it), not
a measurement taken from a live render. Said plainly rather than
implied: if that offset looks wrong once seen for real, it is a number
to adjust, not a structural claim.

`.vthumb` — the placeholder shown before a preview loads, and the "no
document retained" fallback — now fills `.vpreview` completely rather
than sitting as a small 150px box inside a much taller one. Checked
first that it has no other use anywhere in the app that a taller
version would have broken.

## What had no test before this

Browser-level coverage of the unreadable note never existed — decision
0161 built the backend behaviour and this file's own component, but no
test ever exercised what a document that failed intake actually looks
like on screen. Two written for the move: the note shows in
Timeline / Chat and nowhere under the image, and shows nowhere at all
for a document that read cleanly. Probed: suppressing the note
entirely fails the first correctly.

vf-ui: 49 Worker, 312 browser. Neither `vf-app` nor `vf-licence`
touched.
