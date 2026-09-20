# 0412 — The window with no button of its own

**Status: built.**

---

## What was asked

Reported live, verbatim: *"Are you able to configure the system, so
that when a different skin (such as Day or Night), or a different
language (such as English or German) is selected in the main browser,
that your selection is pushed to the current screen, but also push to
the extended Document Image viewer, when the image viewer is Expanded,
to the breakout window?"*

The main window already pushed each choice to itself: `moodPicker()`
sets `data-mood` on `<html>` directly, live, no reload; `languagePicker
()` reloads the same window it was clicked in, which is as live as a
full-page mechanism gets. Neither reached the document pop-out
(decision 0384) while it was already open — the pop-out carries no
mood or language button of its own, and only ever read either setting
once, at its own boot. A person who opened Expand, then changed the
skin or the language in the main window behind it, saw the pop-out
sitting in whichever one it started in until they closed and reopened
it.

---

## What was built

**`storage`, not a message channel.** The pop-out is same-origin
(decision 0384's own reasoning for building it as a real page rather
than a raw file), so it already shares `localStorage` with the main
window without anything new. `storage` is the one event the platform
delivers to a same-origin window for free the moment a *different*
window of its own writes to that storage — never fired back at the
window that made the change, so the button's own window never loops on
its own click, and nothing had to be built to carry the signal across.
`document-window.js` (decision 0384) already chose plain navigation
over `postMessage`/`BroadcastChannel` for retargeting the pop-out to a
different task; this reaches for the same platform primitive rather
than adding a channel neither of those needed.

**`mood.js` gains `watchMoodChanges()`** — a `storage` listener that,
on a change to `vf-mood`, sets `data-mood` directly (falling back to
`systemMood()` if the value is ever cleared, matching `currentMood()`
's own fallback). Pure CSS from there: `tokens.css`/`app.css` key off
the attribute alone, so the pop-out re-themes the instant the attribute
changes, no re-render needed.

**`strings.js` gains `watchLocaleChanges()`** — a `storage` listener
that, on a change to `vf-locale`, calls `location.reload()`. A reload,
not an in-place re-render, matching what `languagePicker()`'s own
`onclick` already does on the window where somebody actually clicked
it (decision 0302's own reasoning: no router, no way to re-open
whichever screen is showing from outside itself). The pop-out's own
`document-window.js` already reads which invoice to show from its own
URL on every load, so a reload lands back on the same document, now in
the newly chosen language.

**`document-window.js`'s `boot()`** calls both, first thing, before
`loadStrings()`.

**The main window needed nothing.** Both `moodPicker()` and
`languagePicker()` already apply their own choice to the window they
were clicked in — a toggle button setting the attribute directly, a
reload of the same page. "Pushed to the current screen" was already
true; the pop-out was the one place a push never arrived.

---

## Tests

`workers/vf-ui/test-browser/mood.test.ts` — three new tests on
`watchMoodChanges()` directly: applies the other window's own choice,
ignores an unrelated storage key, falls back to the system's own mood
if the stored value is ever cleared. Dispatched via `window.
dispatchEvent(new StorageEvent(...))`, never a same-window
`localStorage.setItem` — the spec never fires `storage` back at the
window that wrote it, so a same-window write would prove nothing here.

`workers/vf-ui/test-browser/tasks.test.ts` — two new tests on
`watchLocaleChanges()` directly, the same way: reloads on a `vf-locale`
change, ignores an unrelated key. `location` stubbed via `vi.
stubGlobal` rather than `document-window.test.ts`'s own `defineProperty`
helper — this file's own top-level `afterEach` already calls `vi.
unstubAllGlobals()`, needed here because later describe blocks in this
file read `location` for real navigation and must not inherit a stub
that only has `reload` on it.

`workers/vf-ui/test-browser/document-window.test.ts` — two new tests
confirming `document-window.js`'s real `boot()` actually wires both
watchers up: opens the pop-out, dispatches a `vf-mood` change, asserts
the attribute changed; opens it again, dispatches a `vf-locale` change,
asserts `location.reload()` was called. Fail-first verified by
stashing `document-window.js`/`mood.js`/`strings.js` together: both
failed correctly (one asserting `"night"`, got `"day"`; one asserting
`reload` was called, got never-called), then passed once restored.

Full vf-ui suite: **74/74 Worker, 728/728 browser** (721 + 7 new) — the
same pre-existing 162-error batch of unhandled promise rejections in
`document-window.test.ts` and `documents.test.ts` (unrelated, present
before this change) is unchanged. `eslint` clean on every changed file.
`scripts/check-citations.py` clean once this record exists.

---

## What is not built

**No propagation the other direction.** The pop-out has no mood or
language button of its own to push a change *from* — this is
one-directional by the nature of what exists, not a scope decision.

**No propagation between two ordinary tabs of the main app.** Two
browser tabs both showing the shell, open at once, do not currently
re-theme or reload each other live either — the same `storage` gap,
never reported and not what was asked here. `watchMoodChanges()`/
`watchLocaleChanges()` are exported plainly enough that wiring them
into `boot.js` too would be a small, separate follow-up if that is
ever wanted.
