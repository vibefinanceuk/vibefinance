# 0413 — A language has no relationship to the org

**Status: built.**

---

## What was asked

Reported live, verbatim, right after decision 0412 shipped: *"This
works great, however there is one small issue, which I think was
already in place before the update. This is that when the language is
changed, the main browser window resets, and redirects to the
Dashboard, which I believe is the default window, rather than keeping
focus on the invoice task that is currently on the screen. Is there a
way to keep the current session window, and update the language rather
than redirecting?"*

Correctly self-diagnosed: this predates decision 0412 entirely.
`languagePicker()`'s own `onclick` has called `location.reload()`
since decision 0302 first built it — a full reload always lands back
on `start()`'s own default landing screen (the Dashboard, decision
0359), regardless of what had been open, because nothing about the
screen or the invoice on it survives a reload. Decision 0412 fixed the
document pop-out's own copy of the underlying gap (a change never
reaching a window that needed it); this is the main window's own copy
of the same underlying gap (a change reaching the window, but by the
one mechanism — a reload — that cannot help but forget what it was
showing).

---

## What was built

**Exactly decision 0362's own precedent, not a new mechanism.** The
org switcher used to reload too, for the identical reason — "no router
and no way, from outside a screen, to ask whichever one is open to
re-fetch itself" — until `go()` (already built for nav clicks) made
that reasoning stop holding, and `relaunchAfterOrgChange()` replaced
the reload with it. `languagePicker()` gains the same `onChosen`
callback shape `orgPicker` already takes: `strings.js` calls it after
storing the choice and never needs to know what it does, the same
separation `orgs.js`'s own doc comment already gives for why `orgPicker`
does not import from `tasks.js`.

**`relaunchAfterLanguageChange()`, in `tasks.js`**, alongside
`relaunchAfterOrgChange()`. Refreshes `strings.js`'s own module state
first (`loadStrings()`) — every screen's `render()` calls `t()`
throughout, so this has to resolve before anything re-renders — then:

- **No task open:** `go(current)`, re-fetching whichever screen was
  already showing, in the new language.
- **A task open:** reopens that exact task, rather than falling back
  to the default screen.

**The one real difference from `relaunchAfterOrgChange()`.** That
function's own fallback to the default screen when a task has focus is
deliberate, not an oversight — the operator's own reasoning for it,
decision 0362: "that invoice would be specific to the org the user is
navigating away from." A language carries no such relationship to the
document on screen. The same invoice, read in German instead of
English, is still the same invoice — so keeping it in view is the
right answer here, where dropping it was the right answer there. Two
functions, not one with a flag, because the thing that makes them
different is a real, stated business reason, not an implementation
detail.

**`viewer.js` gains `currentTask()`**, returning the exact `task`
object the viewer is currently open on — the same object `openViewer()`
has kept in its own module-level `current` since decision 0106,
exported now because `relaunchAfterLanguageChange()` needs to hand it
back to `openViewer()` a second time rather than re-deriving it from
just an invoice id, which would mean a second fetch for data this
module already has in hand.

---

## Tests

`workers/vf-ui/test-browser/tasks.test.ts` — two new tests, nested
under "the language toggle," mirroring decision 0362's own two: opens
Documents, changes the language, confirms the nav still shows Documents
as current (not bounced to the default screen) and that `/api/ui-
strings` was requested with `locale=de`; opens a task, changes the
language, confirms the viewer is still open, on the same document,
with a fresh `locale=de` request behind it — the opposite assertion
from the org switcher's own equivalent test, for the reason stated
above. Fail-first verified by stashing `strings.js`/`tasks.js`/
`viewer.js` together: both failed correctly (a stale `en-US` request
where `de` was expected — `location.reload()` is a no-op in this test
environment, so nothing re-fetches at all), then passed once restored.

**A real gap in `openList()`'s own shared stub table, found and closed
along the way.** `APPROVAL_TASK`'s subject is `inv-9`; opening its
viewer makes several fire-and-forget fetches (`document-url`,
`progress`, `pages`, `activity`) that `openList()`'s stub table never
covered, silently surfacing later as unhandled rejections blamed on
whichever test happened to be running when each one finally settled —
the same class of noise this project has flagged and tolerated
elsewhere. Reopening the same task a second time (this decision's own
new behaviour) doubled that noise for the tests here, so the four
routes are stubbed for real now, in the one shared table many other
tests in this file already use. Incidental, welcome side effect: two
of the file's own three pre-existing unhandled-rejection errors were
this same gap and are gone now too — not this decision's purpose, but
a fair consequence of closing it properly rather than routing around
it.

Full vf-ui suite: **74/74 Worker, 730/730 browser** (728 + 2 new). The
known pre-existing unhandled-rejection count in this file dropped from
3 to 1 (the remaining one lives in a different, untouched test's own
inline stub, not `openList()`'s); the browser suite's total count
dropped from 162 to 160 for the same reason. `eslint` clean on every
changed file. `scripts/check-citations.py` clean once this record
exists.

---

## What is not built

**No change to `relaunchAfterOrgChange()`'s own default-screen
fallback.** That behaviour is correct for what it is answering and
untouched here.

**No shared helper between the two relaunch functions.** They differ
in exactly the one place that matters (what happens when a task has
focus) and are short enough that extracting their common shell (check
`viewer.hidden`, otherwise `go(current)`) would trade two readable,
independent functions for one with a branch parameter naming what the
branch is for — not a trade this codebase has taken for
`relaunchAfterOrgChange()` and `go()`'s own overlap either.
