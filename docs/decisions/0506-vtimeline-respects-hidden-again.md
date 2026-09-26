# 0506 — `.vtimeline` respects `hidden` again

**Status: built and verified locally, not yet committed/pushed at the
time of writing.**

## What was asked

Reported live, against two screenshots taken right after decision 0505
was confirmed working:

> the system alert saying "System Alert / This document could not be
> read automatically. Please manually enter the fields in the cells
> provided." seems fixed and visible in the page when the Timeline /
> Chat is displayed, and when the document is displayed, this stays on
> the page and hovers over the line items card. This message should
> simple be at the top of the Timeline / Chat I believe and not
> permanently on display.

## What was found

A regression from decision 0504, made minutes earlier in this same
session — and the exact same bug class this codebase has already
found and fixed twice before, in two different elements:

- Decision 0271, for `.backdrop`: *"`display: flex` beats `[hidden]`'s
  own default... a class rule and the browser's own `[hidden] {
  display: none }` land at equal specificity, and the author's own
  rule wins the tie."*
- The existing `.activitytabcontent[hidden] { display: none }` rule,
  for the same reason, on a different element.

`timelinePane` (`.vtimeline`) had no class at all until decision 0504,
so it had no `display` rule of its own — the browser's own default
`[hidden] { display: none }` was the only thing governing it, and it
worked correctly: `select()` (`viewer.js`) sets `hidden` on whichever
tab's pane is not the active one, and Document/XML being selected
correctly hid the whole Timeline / Chat pane, System Alert included.

Decision 0504 gave `.vtimeline` its own `display: flex` (needed to
make it a real flex column with a real height). That is precisely what
now overrides the browser's default `[hidden]` behaviour — the same
mechanism decision 0271 already documented. `select()` still sets
`hidden = true` correctly (confirmed — every existing test asserting
`.closest("[hidden]")` on this pane still passes), but nothing in the
CSS honours it any more, so the pane stays visually on screen,
overflowing past the Document card's own bottom into whatever sits
below it in the grid — Invoice Lines, in the reported screenshots.

## What was decided

The exact fix decision 0271 and `.activitytabcontent[hidden]` already
established: an explicit `.c-document .vtimeline[hidden] { display:
none; }`, at the same selector scope as the rule that gave it `display:
flex` in the first place, so it wins the same cascade position.

No change to what the alert says, where it sits inside the Timeline /
Chat pane, or anything else about the pane's own layout (decision
0504's own work stands) — this restores exactly the hide/show
behaviour that already existed before that decision, now compatible
with the real height it also needed.

## What was built

- **`workers/vf-ui/public/app.css`**: `.c-document .vtimeline[hidden]
  { display: none; }`, added beside the rule that set `display: flex`
  on it.
- **`workers/vf-ui/test-browser/viewer.test.ts`**: a new test, reading
  the real stylesheet text the same way the existing
  `.activitytabcontent[hidden]` test does (jsdom applies no CSS),
  confirming the new rule exists and resolves to `display: none`.

## What was not built

No change to `.vtimeline`'s own `display: flex` (decision 0504) — it
is still needed for the pane's real height. No change to the System
Alert's own markup or position within the pane — it already renders at
the top of Timeline / Chat, above the feed, exactly as asked; the bug
was only that Document/XML's own tab selection failed to hide the pane
at all.

## Verification

- `workers/vf-ui`: `viewer.test.ts` (browser) — new test passing.
  Full browser suite **1185/1186** — the one failure is the same
  pre-existing, unrelated `typography.test.ts` hardcoded-`10px` gap
  already confirmed to predate this work. Plain suite **75/75**,
  unchanged. `npx eslint` clean on the touched test file.
