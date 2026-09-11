# 0214 — A screen that rendered nowhere

**Status: fixed.** The supplier screen opens, and a test proves it does.

---

## Reported by using it

> I see the new supplier menu item on the left, but it does not link
> anywhere currently.

**Two faults, either of which alone would have done it.**

**The wrong imports.** `el`, `note` and `setCurrentScreen` were imported
from `strings.js`, which exports none of them — they live in `tasks.js`,
and only `t` is in strings. So the module **threw on import**, and a
click on a menu item that awaits a failing import does nothing at all.

**And the wrong element.** It rendered into `#main`, which does not
exist. Every other screen builds through `frame` and `topbar` and
replaces `#shell`.

---

## Every test passed

This is the part worth keeping.

Decision 0213 shipped with **twenty-five route tests, a string-coverage
check, and a navigation test asserting the menu item appeared.** All
green, and the screen could not be opened.

**Because nothing tested that it opened.** The route was tested, the
strings were tested, the menu item was tested — and the join between
them was not.

**Decision 0191 found exactly this** and I did not check for it:

> A screen that does not follow the shell's own pattern is a screen the
> navigation cannot reach.

---

## The test that was missing

Three assertions, and the first is the whole point: **`open()` puts
something in `#shell`.**

Rendering correctly proves nothing if the module cannot be imported or
writes to an element that is not there. **Watched to fail** by pointing
it back at `#main` — three tests break.

---

## What this says about the pattern

`frame`, `topbar`, `#shell`, `note` as a local function, imports split
between `strings.js` and `tasks.js` — **none of that is written down
anywhere**, and a new screen gets it right by copying an old one.

I did not copy one. **That is now the fourth list maintained by
remembering**, after the proxy allow-list, the browser alias map and the
string fixtures — and the only one with no list at all.

**Not fixed here**, and a real fix is probably a screen that is created
from a template rather than described in a record.
