# 0322 — A failed load says so

**Status: built.** A real bug, found live, not the permissions gap it
first looked like.

---

## What was asked

> not - I'm unable to access the role menu option. perhaps because of
> my user permissions, with alice?

Investigated the permissions hypothesis first, since it was the most
likely explanation. It was wrong: Alice genuinely holds
`Admin.Configure`, confirmed directly against the live database
before writing a single line of code. The nav item shows correctly.

> No - the Roles menu option does not launch anything.

A different bug, found by re-reading `roles.js`'s own `open()`:

```js
export async function open() {
  setCurrentScreen("roles");
  if (!(await load())) return;
  render();
}
```

If the request to `/api/org/overview` fails for any reason — a real
server error, a network hiccup, anything — this returns silently.
Nothing changes on screen. A click on the nav item and a broken nav
item are indistinguishable from where Alice was standing.

**Not unique to this screen.** `documents.js` has the identical
shape, and `rules.js`'s own attempt at a fix does not actually work on
a cold first load — the element it writes an error into is built
inside `render()`, which never ran. Noted here since it is a real,
separate finding; not fixed here, since fixing two other screens was
not what was reported and each deserves its own verification rather
than a bundled, unreviewed change.

## What was built

**`open()` now shows a real error and keeps the nav reachable** rather
than leaving `#shell` untouched. The error state is built with the
same `frame()`/`topbar()` wrapper every real render already uses, so
a failed load still leaves a person able to navigate away rather than
stranded on whatever was on screen before — or, on a first-ever visit,
nothing at all. The actual failure — the response status, or the
caught error — is logged to the console, so a real cause is visible to
whoever needs it without exposing raw error detail in the product
itself.

## What has coverage

One new test: a failing `/api/org/overview` response shows the real
error message, and the nav itself (`.nav`) is still present in the
DOM — not just "an error shows somewhere," but specifically that the
screen stays navigable. Probed directly: reverting `open()` to its
original silent-return shape fails the test correctly.

vf-app unaffected — this was entirely a frontend gap. vf-ui: 49
Worker, 425 browser (was 424). One migration, one new string in two
locales.

## What is not built, and this matters

**The same gap in `documents.js` and `rules.js` remains open.**
Neither was reported broken, and neither was touched here — worth
fixing deliberately, as its own piece of work, not folded into a
different screen's own bug report.

**What actually caused the live 500 (or whatever the real failure
was) is still unconfirmed.** This fix makes the failure visible;
it does not diagnose or resolve whatever is failing underneath.
