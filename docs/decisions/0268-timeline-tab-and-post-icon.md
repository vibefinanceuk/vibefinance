# 0268 — An icon for the post button, and a tab layout not yet built

**Status: the icon is built. The Document / Timeline tabs are not** —
mocked up and their direction confirmed, but "looks good" on a mock-up
is not the same instruction as "build it," and the operator's own
words that followed asked specifically for the icon. Recorded
separately below so neither is overstated.

---

## The Document / Timeline tabs — mocked up, not yet built

> Please can we have the activity box instead a tab where the document
> view exists. I pictured two tabs, reading "Document" and
> "Timeline / Chat".

Mocked up against the real viewer layout rather than a generic chat-UI
sketch: the document preview and the activity feed sharing one panel —
the same one that has always held the preview — switched between with
two tabs, rather than the feed living in a separate drawer below it.

**One tradeoff named plainly in that mock-up, before any code
changed**: the document and the conversation could no longer be
visible at once under this design — reading a comment would mean the
invoice itself is off-screen for that moment, which the current drawer
does not require. The operator confirmed the direction ("looks good")
without yet confirming that trade specifically, and the very next
instruction was about the post button, not the tab structure.

**Nothing in `viewer.js` or `activity.js` was changed for this part.**
The panel still opens as the drawer decision 0267 shipped. Building the
real tabs is separate, future work.

## An icon for the post button — built

> can you create a logo for the post, per other screens, so it is
> consistent?

Every other action in this app — `actionLink`, `toolButton`, the rule
rename control — pairs an icon with its label; the activity panel's
own Post button, shipped in 0267, was the one text-only exception.

A paper plane — the shape nearly every messaging surface already uses
for "send," not invented for its own sake: a person should recognise
it without reading the word beside it, the same argument this file's
own header already makes for `release`'s open padlock and `discard`'s
archive box.

vf-ui: 49 Worker, 308 browser. Neither `vf-app` nor `vf-licence` was
touched by this record.
