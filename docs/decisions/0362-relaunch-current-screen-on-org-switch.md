# 0362 — Relaunching the Current Screen on an Org Switch

**Status: built.** Reported live: "when changing Org via the button
on the page, [...] relaunch the current page that has focus. This
would refilter the content of the page with the new org that is
selected. One exception here, would be if a document or task has
focus. Because that invoice would be specific to the org the user is
navigating away from. In that case, simply revert to the default
page."

---

## What changed, and what it replaced

Choosing an org used to call `location.reload()` — decision 0314's own
choice, reasoned at the time as the only option: "this app has no
router and no way, from outside a screen, to ask whichever one is open
to re-fetch itself." A full reload also always landed on whatever
`start()` treats as the default screen, regardless of what had been
open — a real, separate behaviour the operator's own report named
directly as unwanted, not merely a side effect of how the reload
happened to work.

`go()` already is exactly the way decision 0314 said did not exist —
built later, and already used by every nav click to re-open a screen
fresh. `orgPicker`'s own `choose(id)` now calls a callback
(`onChosen`) after storing the choice, rather than reloading. `tasks.js`
passes `relaunchAfterOrgChange`, which checks whether the viewer — a
specific document or task — currently has focus (its own `hidden`
attribute, already the one signal every place that opens it,
`tasks.js` and `documents.js` alike, sets and clears consistently) and
either falls back to the default screen or calls `go(current)` to
re-fetch the same screen the person was already looking at.

**`orgs.js` stays free of `tasks.js`.** The file's own standing rule —
no import from `tasks.js`, to avoid the circular dependency `tasks.js`
importing `orgPicker` from here would create — held without exception:
`orgPicker` takes `onChosen` as a plain parameter and never needs to
know what it does or that `relaunchAfterOrgChange` exists by name.

**A real, second gap found while building this.** The pop-out itself
lives on `document.body`, outside `#shell`. Relaunching a screen only
ever replaces `#shell`'s own content, so without an explicit fix the
pop-out would have stayed open, sitting over whatever screen just
re-rendered beneath it. `choose()` now closes it directly before
calling `onChosen`.

**`openDefaultScreen()`, named and shared.** Extracted out of `start()`
into its own function so `relaunchAfterOrgChange`'s own fallback and
`start()`'s own first landing read from the identical definition of
"the default screen" — the same reasoning already applied to
`unitClause` (decision 0358) and `body.working` (decision 0361): one
definition a second caller can reuse is safer than two that could
quietly drift apart.

## What has coverage

Three new tests, each probed directly by reverting the specific piece
of logic it covers: relaunching re-fetches the screen the person was
already on rather than bouncing to the default (reverting to "always
open the default" fails it); the viewer-focus exception reverts to
the default screen instead of trying to keep an org-specific record in
view (reverting to "always call `go(current)`" fails it); the pop-out
closes itself rather than being left open over a relaunched screen
(reverting the backdrop-hiding line fails it). Two existing tests
updated for the new, real behaviour: the org label is now expected to
update immediately, since `choose()` re-renders it synchronously
rather than relying on a reload to rebuild it from scratch, and the
describe block's own leading comment, which said "nothing downstream
filters by the choice yet," updated to reflect that four screens
already do.

`vf-ui`: 69 Worker (unchanged), 544 browser (was 541, +3). `vf-app`
and `vf-licence` untouched.
