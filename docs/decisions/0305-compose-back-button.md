# 0305 — Back, top right of Write a rule

**Status: built.**

---

## What was asked

> Please can you add the back button, at the top right of the page for
> Write a rule?

`compose.js` is "Write a rule" (`compose.title`) — `rule.js`, a
similarly-named but different file, is the detail page for viewing an
existing, already-activated rule. Confirmed against the real string
key before building anything, since the two are easy to conflate by
name alone.

## What was built

Same shape as the viewer's own Back (decision 0284): `icon("back")`
beside a label, `.actionlink` styling, passed into `topbar()`'s own
`right` array so it lands left of Night/Day, with decision 0304's own
boundary line drawn beside it automatically — this is exactly the kind
of page-specific control that line exists to set apart.

**Its own string, `compose.back`, rather than reusing `viewer.back`.**
Both currently read "Back," but keeping them separate lets either
screen's own wording move independently later, matching how this
screen already keeps its own strings apart from the rule detail
page's, despite similar names.

**A dynamic import back to Rules**, `const { open } = await
import("/rules.js")`, matching the direction `rules.js` already
imports `compose.js` in — a static import either way would be
circular, since each screen already opens the other.

## What has coverage

Two tests: one confirms Back's own position — inside `topbar()`'s
`right`, left of the mood button, with the boundary line present
beside it; a second clicks it and confirms the topbar's own heading
reads "Rules" — checked there specifically, not anywhere in
`document.body`, since "Rules" already appears in the nav sidebar on
every screen including this one, and a text-anywhere check would pass
whether or not the button had done anything at all.

**The second test needed a real second pass, not just a widened
selector.** A first version checked for a stage name from the stub
data, which turned out to already be the current screen's own
subtitle regardless of navigation — a check that couldn't distinguish
the button working from the button doing nothing, since the same text
was already on screen from `compose.js`'s own `stage.name`. Rewritten
against the topbar's own heading instead. It then failed even with the
real, correct code: two fixed `setTimeout(0)` ticks resolved before
the real chain did — a dynamic `import()`, then `Promise.all` of two
fetches, then a render, genuinely deeper than a tick or two. Confirmed
directly by logging the heading at each tick before fixing it: still
"Write a rule" two ticks in, correct only once actually waited for.
Fixed by polling for the real condition rather than guessing a longer
fixed wait, the same lesson decision 0249 already recorded once.

Both tests probed directly against the finished code: removing the
button fails both; emptying its own `onclick` while leaving the
button in place fails only the navigation test, confirming that one
checks behaviour, not just presence.

vf-ui: 49 Worker, 389 browser (was 387). vf-licence: 320. One
migration, one new string in two locales.
