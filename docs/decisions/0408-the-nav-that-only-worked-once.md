# 0408 — The nav that only worked once

**Status: built.**

---

## What was asked

Reported live, plainly: *"When in the Validation window, none of the
menu links on the left work."*

---

## The investigation

`openViewer()` (`viewer.js`) calls `frame()` — the same function every
other screen uses, nav included — and renders it into `#viewer`, a
sibling of `#shell` rather than a screen inside it. Every entry point
into `#viewer` hides `#shell` and shows `#viewer` on the way in, and
reverses that on the way out: `openTaskById`/`act()`'s own `key`
branch in `tasks.js`, `documents.js`'s own `expand()` — each one
carries its own explicit pair of `hidden` assignments, and the second
one's own comment (decision 0165) already names the exact failure
mode this pattern exists to avoid: *"`openViewer` renders into
`#viewer` and does not unhide it... the viewer rendered into a hidden
element and nothing appeared to happen."*

`.navitem`'s own `onclick` calls `go(screen)` — the one function
behind every nav link, everywhere, since it is `navLink()` in
`tasks.js` that builds every nav entry and `frame()` is the one thing
both `#shell`'s own screens and `#viewer` render through. But `go()`
itself carried no version of the hide/show pair above: every branch
inside it writes straight into `shell` — `tasks.js`'s own module-level
`const shell = document.getElementById("shell")` — regardless of
whether `#shell` or `#viewer` is the one currently on screen. Clicking
a nav link from inside an open task silently rebuilt the *hidden*
`#shell`, while `#viewer` — still visible, never told to hide — showed
exactly what it showed before the click. The click was never lost or
swallowed; it did real work, on the one element nobody was looking at.

Every screen module reaches `#shell` the same way (`dashboard.js`,
`sources.js`, `rules.js`, `suppliers.js`, `purchase-orders.js`,
`documents.js`, `access.js`, `processes.js`, and `go()`'s own `tasks`
fallback all confirmed directly), so this was not a broken link here
and there — it was **every** nav destination, equally, the whole time
a task has been open, which matches "none of the menu links... work"
exactly.

**This had already been solved once, for a narrower case.** Decision
0362's `relaunchAfterOrgChange()` checks `document.getElementById(
"viewer").hidden` before deciding whether to call `go(current)` or
revert to the default screen — built specifically for the org
switcher, whose own comment already assumed `go()` was "exactly" the
safe, reusable way back in. It wasn't, for the one caller that
mattered here: a plain nav click.

Not a regression from anything built this week — `go()`, `frame()`,
and the `#shell`/`#viewer` split all predate decisions 0405/0406, and
neither of those touched this file. It looks to have been there since
the nav first became something every screen carries (decision 0108),
never exercised in a way anyone would have noticed until now.

---

## What was built

### `workers/vf-ui/public/tasks.js`

`go(screen)` now checks `#viewer`'s own `hidden` state, first, before
any of its branches run — the same check `relaunchAfterOrgChange()`
already does, generalised to the one place every nav click actually
starts rather than left for each caller to remember:

```js
const viewer = document.getElementById("viewer");
if (viewer && !viewer.hidden) {
  viewer.hidden = true;
  shell.hidden = false;
}
```

Every existing caller of `go()` is unaffected when `#viewer` is
already hidden (the ordinary, `#shell`-only case) — the check is a
no-op there. `relaunchAfterOrgChange()` itself is untouched: its own
"revert to the default screen" branch never reaches `go()` at all, so
nothing here changes what it does.

---

## Tests

`workers/vf-ui/test-browser/tasks.test.ts` — one new test: open a
task (making `#viewer` visible, matching the row-click pattern
decision 0288's own test already established), click Documents from
the nav rendered inside it, and confirm `#viewer` hides, `#shell`
shows, and `/api/documents` was actually called. Fail-first verified
— stashed the fix alone, confirmed the assertion failed with `#viewer`
still visible (the reported bug, reproduced exactly), restored the fix,
confirmed it passes. Full `vf-ui` suite: 74/74 Worker, **712/712**
browser (711 + 1 new) — a pre-existing 162-error batch of unhandled
promise rejections in `document-window.test.ts` (an un-awaited XML-tab
fetch, unrelated to this fix) is present identically with and without
this change, confirmed directly by re-running the full suite against
the unstashed baseline.

`eslint` clean. `scripts/check-citations.py` clean.

---

## What is not built

**Nav-item highlighting from inside an open task** is unaffected
either way — `current` is set at the top of `go()` regardless, and
whether the right `.navitem` carries `.on` while `#viewer` is showing
was not part of what was reported or investigated here.
