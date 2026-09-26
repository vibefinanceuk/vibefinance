# 0504 — The Timeline / Chat pane keeps its own height

**Status: built and verified locally, not yet committed/pushed at the
time of writing.**

## What was asked

Reported live, against two screenshots of the same task at AP Review:

> I've noticed an alignment issue... The comments box at the bottom is
> very low the the bottom edge of that card. When I select the Add
> Person button to add someone to the chat, they comments box moves
> beyond the bottom of the card, and into the invoice lines card
> below. Can you resolve this to ensure the comments box is always
> within the boundaries of the card. Ideally I would like the Comments
> box and Post button to retain a fixed position at the bottom of the
> Timeline / Chat window. The user can scroll up and down the entries,
> but the comments box retains a fixed position whether it is full
> screen and empty, or full of many entries.

## What was found

`timelinePane` — `viewer.js`'s own wrapper around the collaborator
bar, the optional System Alert, and the activity feed — had no class
of its own. `.c-document`'s existing height chain (`.panel` gets
`height: 100%`, `normalBody` gets `flex: 1; min-height: 0`, and
`.vpreview` claims `height: 100%` of that, decision 0391) only ever
reached the Document/XML panes' `.vpreview`, because nothing selected
`timelinePane` at all. Left in plain block flow, it took whatever
height its own content added up to — the reply box sat wherever the
feed happened to end, not pinned to the card's own bottom edge, and
opening "Add person" made that content taller still, pushing the reply
box, and everything below the card, down into the Invoice Lines card
underneath it.

This is the exact overlay-into-the-next-row bug decision 0391 already
found and fixed once for this same grid cell — just never wired up for
this particular pane, since it had never had a class to hang a rule on.

## What was decided

Give `timelinePane` a class (`vtimeline`) and the same real,
flex-computed height `.vpreview` already gets, so the card's own
bottom edge is a real boundary rather than a suggestion:

- `.c-document .vtimeline` — `height: 100%; min-height: 0; display:
  flex; flex-direction: column`, the same shape `.vpreview` uses,
  stacking the collaborator bar, the optional alert, and the activity
  feed.
- The collaborator bar and the System Alert keep their own natural
  size (`flex: 0 0 auto`) — opening "Add person" should not shrink
  them, only make room for them.
- `.activitytabcontent` (the feed plus the reply box) takes whatever
  is left, `flex: 1 1 auto; min-height: 0` — the same "last one grows"
  shape decision 0478 already used for a stack of unequal panels
  sharing one row.
- Inside it, `.activityfeed` changes from a flat `max-height: 300px`
  to `flex: 1; min-height: 0`, so the entries — not the reply box —
  are what scrolls and what gives way when space is short.
  `.activityinput` gets an explicit `flex: 0 0 auto`, so it never
  shrinks and never drifts: a fixed row at the bottom of the card,
  exactly as asked, whether the feed is empty or long.
- The narrow-screen fallback (`@media (max-width: 1100px)`, where the
  Document card goes back to a plain, un-shared-row height) gets the
  same `calc(100vh - 300px)` `.vpreview` already uses there, so the
  pane still has a real height to bound itself to.

This is layout-only. No change to what the feed shows, how comments
post, or the collaborator search itself.

## What was built

- **`workers/vf-ui/public/viewer.js`**: `timelinePane` now built with
  `class: "vtimeline"`.
- **`workers/vf-ui/public/app.css`**:
  - `.c-document .vtimeline` and its children's flex rules, beside the
    existing `.c-document .vpreview` rule.
  - `.c-document .vtimeline { height: calc(100vh - 300px); }` in the
    narrow-screen media block, beside `.vpreview`'s own.
  - `.activityfeed` — `max-height: 300px` replaced with `flex: 1;
    min-height: 0`.
  - `.activityinput` — explicit `flex: 0 0 auto`.
- **`workers/vf-ui/test-browser/viewer.test.ts`**: a new test, reading
  the real stylesheet text the same way the existing "actually hides
  the timeline pane visually" and "does not colour the system alert
  orange" tests already do (jsdom applies no CSS), confirming
  `.vtimeline` exists on the rendered pane and that the three rules
  above are actually in place.

## What was not built

No change to `.docwindowsplitright`'s own outer scroll in the pop-out
window (`document-window.js`) — not reported broken, and the pop-out
already had its own working height chain (`.docwindowtimeline`,
decision 0394). `.activityfeed`'s new `flex: 1` rule is shared code,
so the pop-out's feed now also fills real available space instead of a
flat 300px cap — a strict improvement there, not a behaviour change
anyone reported wanting reverted.

## Verification

- `workers/vf-ui`: `viewer.test.ts`/`document-window.test.ts`/
  `ap-setup.test.ts` (browser) **320/320** (1 new). Full browser
  suite **1183/1184** — the one failure is the same pre-existing,
  unrelated `typography.test.ts` hardcoded-`10px` gap this session has
  already confirmed predates this work. Plain suite **75/75**,
  unchanged. `npx eslint` clean on every touched JS/TS file.
