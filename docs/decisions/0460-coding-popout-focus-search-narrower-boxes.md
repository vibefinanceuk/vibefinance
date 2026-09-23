# 0460 — Every Field Searches on Focus, No Minimum Before Typing Counts, Narrower Boxes

**Status: confirmed pushed and deployed.** `origin/main` fetched
directly reads `52e3d23`, matching this session's own commit exactly,
and the operator confirmed `wrangler deploy` run for `vf-ui`. No
migration — no new string key, so nothing further to apply.

---

## What was asked

Live, once decision 0459 shipped: *"For usability, can we
automatically show the first 25 available rows, when a Line coding
element has focus, limited by what is already type into the box, but
if nothing is type simply show available fields. Automatically update
the list as typing occurs. The width of the box can also be reduced,
probably to 2/3 of the visible width. Can you update the Org / Company
Code field so that it is the same height and width as the fields
beneath it."*

Three things.

## Every field, on focus, not just Cost Centre on open

Decision 0459 gave Cost Centre a dedicated `preload` flag that ran a
blank search once, at the pop-out's own build time. This decision
generalizes that into the field's own `onfocus` handler instead — the
same `runSearch(input.value)` now runs from `onfocus` and from
`oninput` alike, so every field shows its own first page (or whatever
the box already holds, filtered) the moment it gains focus, not only
the one field the pop-out happens to auto-focus on open. Cost Centre's
own decision-0459 behaviour still works exactly as before — its
`.focus()` call dispatches a real `focus` event, which this now
already handles — so the dedicated flag was removed rather than kept
alongside the general mechanism.

**No minimum length any more.** `oninput`'s own two-character gate is
gone; a single typed character, a backspace back to nothing, or a
fresh focus with nothing in the box, all now search immediately — a
blank query is exactly the list's own first page, the same request the
server already serves for "no search clause." The clear ("×") button
follows the same rule: clearing a field now shows its first page again
rather than leaving the results panel blank, since an emptied box is
the same "nothing typed" case a fresh focus would be.

**The one real correctness risk this reopened, and how it's closed.**
`resolveCurrent`'s own rename — the raw id already in the box in
`Marketing`, keyed by a person or otherwise, turning into `Marketing`
once resolved — is itself an async lookup. Without care, a field's own
`onfocus` firing before that settles would search on the raw id rather
than the name about to appear; `onfocus` now `await`s it first.  But
awaiting anything reopens the exact race decision 0458's own
`codingResultsController` was built to close — the person can leave for
another field entirely before that `await` returns, and a plain
"only the newest token counts" guard doesn't help here, because *this*
request is genuinely the newest one issued by the time it finally
fires; the problem is that it was triggered by a focus event that is,
by then, stale. Fixed with one more read on the same controller —
`peek()`, which reads the current generation without minting a new
one. `onfocus` records it before awaiting and checks it again after;
if anything else has searched in the meantime, this one drops itself
rather than searching at all.

## Narrower boxes

`.codingsearch` (the input-plus-clear-button widget) is now `width:
66.6667%` of its own `.editgrid` column, rather than the full column
every other row here still uses. Applied to the grid itself, not just
the `<input>` inside it, so the clear button narrows along with the
box instead of drifting off to the right of a now-shorter one.

## Org / Company Code, matched

The read-only Org / Company Code box picked up its own `codingcompanycode`
class, matched in `app.css` to the same `min-height: 38px` and `width:
66.6667%` the search boxes below it now have — reported live as
visibly inconsistent otherwise (a plain `.readonly` box is 32px tall
per decision 0402's own generic rule, a real `<input>` here is 38px,
and the search boxes had just narrowed while this one stayed full
width). Scoped to `.popout.codingpopout` specifically — `.readonly` is
used across many other screens, and this only restates two properties
for one box in one popout, not a change to the shared rule itself.

## What was not built

- **No change to `.readonly`'s own generic rule**, or to any other
  screen's use of it — this decision restates two properties for one
  box in one context only.
- **No debounce.** Every keystroke still fires its own request, the
  same as decisions 0453/0457/0458/0459 already did for two-or-more
  characters; removing the minimum makes this true from the first
  character too, but nothing here batches or delays requests. Worth
  revisiting if the server ever shows real load from it — not observed
  so far, and out of scope for a usability-only ask.

## Verification

`workers/vf-ui`: the pre-existing decision-0453/0457/0458/0459 "invoice-line
Coding pop-out" describe blocks (21 tests) re-run first — all still
pass unmodified. Five new tests added in a new "every field's own
first page on focus, and no minimum before typing counts" describe
block: focusing a field other than the one auto-focused on open still
shows its own first page; a single typed character already updates the
shared results; clearing a field's own box re-shows its first page
rather than leaving the panel blank; the Org / Company Code box
carries the matching class; and — the one genuine race this decision
reopened — a slow, gated `resolveCurrent` lookup for an already-keyed
Cost Centre, still in flight once the person has moved on to Project
and searched there, does not fire late and steal the results area back
(the same shape as decision 0458's own race test, exercising the other
source of a stale, late request this decision introduces). Full
whole-repo browser suite run unfiltered — **1066/1066 across 48
files** (1061 + 5 new); the pre-existing `document-window.test.ts`
unhandled-rejection flake is present at its identical baseline count
(160 non-fatal errors, none a failing assertion).

No `vf-app`/`vf-licence` change at all, and no new migration — every
string this decision reuses already existed (`viewer.coding.searchhint`,
`.clear`, `apsetup.codingtab.companycode`), and the change is
`viewer.js`/`app.css` only. `npx tsc --noEmit`: the same repo-wide,
pre-existing 753-line baseline as every prior decision this session —
unsurprising, since this decision touches no TypeScript.

## Still to do, operator side

All done — `wrangler deploy` confirmed for `vf-ui`, no migration to
apply this time, both in the operator's own single report: *"deployed
and pushed."*

## Live afterward: the narrowing itself wasn't right

Reported directly, with a screenshot, once this was live: *"the box is
still too wide. The Close button needs to be above the right edge of
the box containing the Org / Company Code. The Org / Company code box
is also still wide and taller than the boxes beneath it."*

All three trace to the same root cause: `.codingsearch`'s own
`66.6667%` and `.codingcompanycode`'s own `66.6667%`/`38px` are two
separately-stated copies of what should be one number, and the
pop-out itself stayed the 900px decision 0458 sized it to (for a
two-column results grid decision 0459 already put back to one column)
rather than shrinking along with the boxes inside it — so Close, still
pinned to that 900px edge, was never going to land above a box that
had just narrowed to a fraction of it.

Asked to mock up rather than build straight to a fix — *"can you mock
up, instead of build, so we can get this right"*. See
`docs/design/mockups/line-coding-popout-widths.html`: a "Current"
replica reproducing the report (including a dashed line marking the
Org / Company Code box's own right edge against Close, well short of
it) beside a "Proposed" version where one shared box width drives the
search boxes, the Org / Company Code box, and the pop-out's own width
together — a slider, so the right number can be found live rather than
guessed and re-shipped. The fix this becomes is decision 0461, once
the operator says what that number is.
