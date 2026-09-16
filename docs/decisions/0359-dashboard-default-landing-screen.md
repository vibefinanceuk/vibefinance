# 0359 — The Dashboard, Not Tasks, Is the Default Landing Screen

**Status: built.** Reported live: "make the default screen launched
at login, to be the Dashboard."

---

## What changed

`boot.js`'s own comment had said it plainly since decision 0103: "a
signed-in person sees their tasks." `start()` rendered the Tasks
screen directly and called `loadTasks()`, never once delegating to
`dashboard.js`.

`start()` now checks `hasMyPermission("AP.Dashboard")` and, if held,
dynamically imports `dashboard.js` and opens it — the same mechanism
`go()` itself already uses for every other screen this file can reach,
not a new pattern invented for this one case. Falls back to the old
Tasks behaviour for anyone who cannot see a dashboard at all: a
default that lands somebody on a screen refused out from under them
would be a worse landing than the one it replaces.

## A real, latent bug this exposed, not merely test fallout

`filterBar()` builds the stage filter's own `<option>` elements once,
from whatever `knownStages` holds at the moment `render()` runs, and
never revisits them. Setting `.value` to a stage with no matching
option — here, or anywhere later — silently does nothing. This is
exactly decision 0254's own bug ("the list was filtered and said it
was not"), for a genuinely new reason: `start()` used to always call
`loadTasks()` once, unconditionally, before anything else could ever
reach the Tasks screen — so `knownStages` was never truly empty by
the time a filtered open (`openTasksFiltered`, the way every dashboard
card reaches this screen) ran its own `render()`. That was never a
deliberate design; it was an implicit ordering nobody had to think
about until landing on the Dashboard first made it false for the
first time.

**A real production path, not only a test scenario.** Anyone who now
lands on the Dashboard first and clicks a card that filters Tasks to
one stage would have seen the stage dropdown silently read "All
stages" while the list beneath it was correctly filtered — the same
disagreement between what a control says and what a list shows
decision 0254 was written to close. `loadTasks()` now adds the
missing `<option>` itself, from the very data that just proved the
stage exists, before re-applying the value — fixed at the source, not
worked around in a test.

## What has coverage

Existing tests updated rather than left passing on stale assumptions:
several needed `/api/dashboard` added to their own stubs, since
`AP.Dashboard` was already in the permission sets they grant and
would otherwise hit a real, unstubbed fetch; a few needed an explicit
visit to Tasks, since they test Tasks-specific behaviour regardless
of what the new default is. The stage-option bug fix was probed
directly — reverting it and confirming the exact test that exposed it
fails again.

`vf-ui`: 69 Worker (unchanged), 537 browser (unchanged in count — no
tests added or removed, all fixed to match the new, correct
behaviour). `vf-app` and `vf-licence` untouched.
