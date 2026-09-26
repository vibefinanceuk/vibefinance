# 0505 — The pop-out window stops growing past the screen

**Status: built and verified locally, not yet committed/pushed at the
time of writing.**

## What was asked

> When the document viewer is expanded into a separate window, the
> Timeline / Chat continues to grow beyond the bottom of the screen.
> For example, I add several new messages and the height of the page
> grows and grows. When docked in one window, the messages acquire a
> scroll bar on the right. Can we provide a scroll bar in the window
> when the Timeline / Chat is viewed from the expanded document
> viewer. The card in which the invoice image, and the Timeline /
> Chat are displayed should fill all of the browser window. But if
> the contents grow beneath that of the viewable space, please add a
> scroll bar in the timeline / chat, rather than continue to add and
> expand the page size.

## What was found

Two bugs in `document-window.html`'s own outermost chrome, not in the
Timeline / Chat pane itself:

1. **`min-height: 100vh` is a floor, not a ceiling.** `body
   .docwindowbody` set `min-height: 100vh` — enough to stop the window
   looking short when there is little content, but nothing stopped it
   growing taller than the viewport once there was more. The *page*
   grew to fit its content instead of clipping anywhere.
2. **`#docwindow-root` had no `min-height: 0`.** A flex item's default
   minimum height is its own content's intrinsic size, not zero — so
   even a genuinely fixed `height` on `body` would not have stopped
   this box refusing to shrink below whatever the document image and
   Timeline / Chat wanted, pushing `body` past its own height exactly
   as before.

Everything *below* this — `.docwindowbody .panel`, `.docwindowsplit`,
`.docwindowsplitright`, `.docwindowtimeline` — already carries its own
correct `flex: 1; min-height: 0` chain, several decisions deep (0384,
0386, 0392, 0394), ending in `.activityfeed`'s own `overflow-y: auto`.
None of it had a real ceiling to compute against, because the chain's
own outermost ancestor never gave it one.

**Very likely surfaced by decision 0504, moments earlier in this same
session.** Before that decision, `.activityfeed` had a flat `max-height:
300px` — a hard cap on the feed regardless of how tall the page around
it was ever allowed to get, which is exactly why a long conversation
growing the window past the screen was never reported until now.
Decision 0504 replaced that cap with `flex: 1; min-height: 0` so the
feed would fill real available space in the *embedded* card (where the
ceiling already existed, via CSS Grid row-matching, decision 0391) —
but the pop-out's own outermost chrome had this defect the whole time,
just invisible behind the old fixed cap.

## What was decided

Fix the outer chrome, not the inner chain — it was already correct.

- `body.docwindowbody`: `height: 100vh` in place of `min-height:
  100vh`, plus `overflow: hidden` so nothing that still wants more
  room can spill out of it once it does have a real ceiling.
- `#docwindow-root`: an added `min-height: 0`, the same reasoning
  every pane below it already carries this for.

With both in place, the existing internal chain — already built,
already tested, and, as of decision 0504, already ending in a real
`overflow-y: auto` on the feed itself — has a genuine height to bound
against for the first time, and does exactly what it was always meant
to: the reply box and Post button stay fixed at the bottom, the
entries scroll internally, and the window itself stops growing.

## What was built

- **`workers/vf-ui/public/app.css`**: `body.docwindowbody` — `height:
  100vh; overflow: hidden` replacing `min-height: 100vh`.
  `#docwindow-root` — `min-height: 0` added.
- **`workers/vf-ui/test-browser/document-window.test.ts`**: a new
  test, reading the real stylesheet text the same way this file's
  neighbours already do (jsdom applies no CSS), confirming both rules
  are in place and the old `min-height: 100vh` is gone.

## What was not built

No change to `.docwindowsplit`/`.docwindowsplitright`/
`.docwindowtimeline`/`.activitytabcontent`/`.activityfeed` — that
chain was already correct; it only ever needed a real ceiling to
resolve against. No change to the embedded card's own layout (decision
0504) — not reported broken, and it never shared this bug, since its
own ceiling comes from CSS Grid row-matching (decision 0391), not from
`body`'s own height.

## Verification

- `workers/vf-ui`: `document-window.test.ts`/`viewer.test.ts`/
  `ap-setup.test.ts` (browser) **321/321** (1 new). Full browser suite
  **1184/1185** — the one failure is the same pre-existing, unrelated
  `typography.test.ts` hardcoded-`10px` gap already confirmed to
  predate this work. Plain suite **75/75**, unchanged. `npx eslint`
  clean on the touched test file.
