# 0283 — Sign out joins the mood picker as the frame's own

**Status: built.**

---

## What was asked

> Can you update the Sign Out button so that it appears on every
> screen, and has an icon like other buttons

## Where it actually lived

`topbar()`'s own comment already named this exact class of problem,
for the mood picker: *"every screen, because the frame carries it...
a preference offered on one screen and not another is one somebody
has to remember where to find."* Sign out never followed that
principle — it was the Tasks screen's own, one-off button, passed as
`topbar()`'s own `right` argument only from `render()`. Every other
screen built its own `topbar()` call with its own `right` items, and
none of them included it. It was reachable on Tasks and nowhere else.

## The fix

Moved into `topbar()` itself, built the same way the mood picker
already is — unconditionally, on every call, regardless of which
screen is asking. The Tasks screen's own one-off button was removed
entirely rather than left alongside the new one, which would have put
two sign-out buttons on the one screen that used to have it.

**Built locally rather than importing `actionLink()` from
viewer.js**, even though it is the exact same icon-and-label shape
already used for the document viewer's own actions and a card's
"Change Seller." `viewer.js` already imports `topbar` from `tasks.js`;
importing `actionLink` back the other way would be a circular import.
The markup is duplicated by a few lines; the `.actionlink` CSS class
is not — both call sites share the one class, so they still look and
behave identically, without either file depending on the other to get
there.

## The icon

A door, open on one side, with an arrow leaving through it — the
conventional shape for "sign out," drawn fresh in this app's own
stroke style rather than invented. The point of an icon here is
instant recognition, and a shape everybody already knows on sight
serves that better than a more original one would.

## What has coverage

Three tests: the button appears exactly once on the Tasks screen
(catching the double-button risk directly, not just its absence);
also appears on the Dashboard, proving the universal placement without
having to check every screen individually, since the mechanism lives
in the one shared function every screen calls; and clicking it
genuinely posts to `/api/sign-out`. All three probed by removing the
button from `topbar()` and confirming they fail together.

**A real, separate bug found and fixed while writing the third test.**
This test file's own local `stubFetch` helper does not accept a
`posted`-tracking parameter the way some other test files' helpers do
— passing one anyway is silently accepted and does nothing, since
JavaScript does not complain about an unused extra argument. The test
appeared to run, the click appeared to register, and the assertion
failed with an empty array regardless of what actually happened.
Rewritten with its own inline fetch mock that genuinely records POST
requests, rather than assuming a shared helper's shape without
checking it in the specific file being written in.

vf-ui: 49 Worker, 339 browser. No migration.
