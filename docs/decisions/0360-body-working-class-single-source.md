# 0360 — body's own "working" Class, Set in One Place

**Status: built.** Reported live, with a screenshot: "deployed and
pushed - the Dashboard now default. It's initial width is narrow on
the page though. When I click tasks and then dashboard again, it
resizes to full width."

---

## Root cause

`body`'s own default CSS (`display: grid; place-items: center`)
exists to centre the sign-in form on a blank page. `body.working`
switches this to the full-width layout the signed-in app needs
(`display: block; place-items: initial`). Until this decision, the
only place that ever added `working` was inside `tasks.js`'s own
`render()` — true only because `start()` used to render Tasks
unconditionally, before anything else could ever run. Decision 0359
gave `start()` a second, equally valid destination — `dashboard.js`'s
own `open()` — that never touched `body` at all.

So: anyone who now lands on the Dashboard first keeps the sign-in
page's own centred, fit-content layout, since nothing has yet told
`body` the app is showing. The moment any navigation happens to touch
Tasks — clicking it, then clicking back — `render()` finally adds the
class for the first time, and the layout corrects itself from then on.
Exactly the symptom reported: narrow on arrival, full width after one
round trip through Tasks.

## Fix

Moved the toggle to `boot.js`, the one place that already knows for
certain whether the app is signed in, regardless of which screen
inside it renders first — right alongside the existing
`shell.hidden`/`signIn.hidden` assignments, which take effect at the
same moment. Removed the old line from `tasks.js`'s own `render()`:
leaving it there too would have kept suggesting one screen owns an
app-wide concern it does not.

## A real, separate gap found while testing this

`boot.js` had never been under test at all — not a missing test file
by oversight, but genuinely unreachable: `vitest.browser.config.ts`'s
own alias map, which every other browser module needs to resolve its
absolute, server-root-style imports (`import { t } from "/strings.js"`)
under Vite, had no entry for `/boot.js` itself. Adding one was a
precondition for writing any test here, not an incidental tidy-up.

## What has coverage

A new file, `boot.test.ts`, covers all three shapes: the class is
added when `start()` lands on the Dashboard, added just the same when
it falls back to Tasks, and never added at all for a signed-out
visitor — so the sign-in form keeps its own centred layout. Probed
directly by removing the fix and confirming the two positive cases
fail while the signed-out one, which expects the class absent either
way, correctly keeps passing.

`vf-ui`: 69 Worker (unchanged), 540 browser (was 537, +3: the new
file). `vf-app` and `vf-licence` untouched.
