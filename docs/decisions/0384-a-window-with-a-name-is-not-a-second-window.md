# 0384 — A window with a name is not a second window

**Status: built.** Phase 4 of `docs/design/document-viewer.md`.

---

## What was asked

Phase 3 (decision 0383) closed with phases 4 and 5 still design only.
The operator, seeing phase 3 deployed:

> Yes please - lets look at phase 4. It looks great so far. thank you!

Phase 4, as the design document states it:

> A second window carrying the whole document panel — the renderer
> from phase 2, its tabs, Timeline/Chat — opened by ordinary
> navigation to a page of our own rather than a raw file, so no
> signed-URL problem exists for the chrome itself (only for the bytes
> inside it, exactly as today). The main window's document card gives
> up its space once a pop-out is open.

Section 6 of the design document left one question genuinely open:
*"The pop-out and the main window agreeing they're the same document
... which mechanism, and what happens if the pop-out is closed without
the main window noticing, is phase 4's own question."* Asked directly
before building anything, since the design document deliberately did
not settle it. The operator's answer, verbatim, is what this phase is
actually built around:

> The users attention should only ever been on one document / task.
> Therefore if another task is opened and the document window is
> pop-out and showing a previous document, the same window should
> open the new document for the new task. There should not be a
> situation where the user has multiple pop-out windows open with
> multiple document displaying.

One window, always. Never a second one, whatever else is opened while
it's up.

---

## What was built

**`window.open(url, name)` with a fixed name is the mechanism, not a
convention this code has to enforce by hand.** A named target the
browser already tracks: calling `window.open` again with the same
name navigates the *existing* window sharing it, rather than opening a
new one. `POPOUT_NAME = "vibefinance-document-window"` is a single
constant, and the "never a second pop-out" half of the operator's
answer falls out of a browser primitive rather than out of code this
project would have to keep correct by hand.

The retarget half — a different task opened while the pop-out already
shows something else — is not covered by that primitive on its own,
since reusing the *name* only matters on the next `window.open` call,
and opening a task from the main window's task list does not call
`openDocumentWindow()` at all. `retargetPopoutIfOpen(invoiceId)`,
called from `openViewer()` on every task open, checks whether a
pop-out is open and showing a *different* invoice, and if so navigates
it directly — `popoutHandle.location.href = popoutUrl(invoiceId)` —
without the user having clicked Expand again. Reusing the same
invoice is a no-op, checked by identity (`popoutInvoiceId ===
invoiceId`), not by re-navigating a window already showing the right
thing.

**`document-window.html` / `document-window.js`**: a second real page
of this app, same origin as `vf-ui` itself, reached by ordinary
navigation rather than `window.open(rawSignedUrl)`. This retires the
raw-file half of decision 0073's `openDocument()` — the *chrome*
around the document, which used to be nothing at all (a blank tab, no
tabs, no Timeline/Chat). Decision 0073's own signed-URL mechanism is
unchanged and still does the one job it was ever for: the page's own
`initDocumentWindow()` calls the same `documentUrl()` the embedded
panel calls, to mint a link for the *bytes*. Only the wrapper around
those bytes changed.

**`buildDocTabs(invoiceId)`**, extracted from `documentPanel()`
verbatim rather than reimplemented, is what both the embedded card and
the pop-out's own page render from — the Document/XML/Timeline-Chat
tab set, built once. `initDocumentWindow(invoiceId, root)`, exported
from `viewer.js` rather than written into `document-window.js` itself,
is the whole shared surface: `document-window.js`'s own job is reading
`?task=` off the URL and handing off, nothing more.

**A fresh module realm, not a second copy of the app's state.**
`document-window.html` is loaded in its own window, so every module it
imports — `viewer.js` included — runs as its own instance with its
own module-level variables. The pop-out's `stored`, `docPanelTab` and
so on cannot collide with the opener's, and nothing had to be written
to keep them apart.

**The embedded card's placeholder, toggled rather than torn down.**
`documentPanel()` now builds two sibling nodes — the normal tab
content, and a placeholder reading *"Open in a separate window"* with
two actions (*"Bring to front"*, *"Show here instead"*) — and a
module-level `popoutStateSetter` function reference flips `.hidden`
between them, the same idiom the existing tab `select()` already uses.
Closing the pop-out is detected by polling `.closed` every 700ms
(`watchPopout()`) — there is no native close event an opener can
subscribe to — and reverts the placeholder the moment it fires.

**Every piece of CSS the app has lived inline in `index.html`, and a
second real page could not reuse any of it that way.** Extracting all
~2,350 lines of the existing `<style>` block into a new `app.css`,
linked from both pages, was not an optional refactor — it was the only
way `document-window.html` could share `.panel`, `.doctabs`,
`.actionlink` and everything else without a second, drifting copy of
the same rules (this project's own stated reason a shared function
exists at all: *"two copies of the same [thing] would eventually not
agree"*). `index.html` fell from 2,449 lines to 97. A handful of
selectors that only ever made sense for the sign-in page's centred
360px layout (bare `body {}`, `main {}`) needed their own overrides
for the new page, the same way `#shell`/`#viewer` already override
them for the main app shell.

**Migration `0121`** (`vf-licence`): four new `ui_strings` keys this
phase needed a word for — the pop-up-blocked warning, the embedded
card's placeholder text, and its two actions — seeded in English (the
minimum this project's own `string-coverage.test.ts` requires) and
German (by convention, not required).

---

## A real bug, found by a test that didn't fail when it should have

`document-window.js`'s own guard —

```js
if (!invoiceId) {
  root.textContent = t("viewer.nodocument");
  return;
}
```

— has a test asserting the pop-out says *"No document retained"*
rather than crashing when the URL carries no `?task=`. Disabling the
guard by hand (watch-to-fail discipline) should have broken that test.
**It did not.** The assertion used `toContain`, and `t("viewer.
nodocument")` is not unique to this guard — `page-renderer.js` shows
the exact same string, for an unrelated reason, whenever a real
invoice resolves to zero pages (decision 0380's own placeholder,
`el("div", { class: "vthumb", text: t("viewer.nodocument") })`). The
test file's own `stubFetch` helper answers *any* `/api/invoices/:id/
pages` route with `{ pages: [] }`, as a convenience for every other
test in the file that doesn't care about pagination — which meant a
guard-bypassed invoiceId of `null` sailed straight through to
`initDocumentWindow(null, root)`, rendered a whole panel, and that
panel's own "zero pages" placeholder happened to contain the identical
sentence the guard would have shown for an entirely different reason.
A substring check could not tell "the guard fired" from "a panel
rendered and coincidentally said this somewhere inside it."

Fixed by asserting the root's *entire* text (`toBe`, not `toContain`)
— set in one assignment by the guard itself and never by anything past
it — plus a second, independent check that `document.title` was never
set to `"Document"` (also only true past the guard). Re-verified: the
guard disabled → fails with the actual rendered panel text visible in
the diff; guard restored → passes. `document.title` also needed
resetting in `beforeEach`, since jsdom carries it across tests in the
same file with no real navigation to clear it — the first version of
the title check failed for a second, unrelated reason (a title left
over from an earlier test) before that was found and fixed too.

---

## Tests, watched to fail

- **`viewer.test.ts`**, "the document pop-out window" — 7 new tests:
  opens with the fixed name and URL; reuses the same window rather
  than opening a duplicate; shows the placeholder while open; reverts
  it when the pop-out closes (fake timers); retargets to a different
  task; skips a redundant retarget to the same task; shows a note and
  does not crash when `window.open` returns `null` (pop-up blocked).
  Four of the seven watched to fail directly against disabled source
  lines, each failing with the exact predicted message before being
  restored.
- **`document-window.test.ts`** (new file), 5 tests: `initDocumentWindow`
  mounts the same tabs the embedded card shows and a Close button that
  calls `window.close()`; offers the XML tab for a hybrid PDF here
  too; has no Expand button and no pop-out placeholder of its own —
  there is nowhere further out for this page to go. The bootstrap's
  own two tests: reads `?task=` and mounts the panel, setting
  `document.title`; and the no-`?task=` guard above, fixed after the
  coincidental-string bug was found and watched to fail correctly.
- **`string-coverage.test.ts`**: the four new keys covered (10/10).

**Full suites, run together.** `vf-ui` browser: 665 passing, up from
653 (12 new tests across the two files above). 151 unhandled-rejection
errors, up from 137 at decision 0383 — the same pre-existing noise
class this test suite deliberately produces on purpose (every unstubbed
route throws `"no stub for ... — add one, or the test proves nothing"`
rather than hanging), now with a few more sources since the new pop-out
tests don't all stub every route the shared panel code touches; not
one of them fails a test, and none is new *behaviour* — only new
places the same known pattern shows up. `vf-ui` Worker: 74, unchanged
— nothing under `src/` was touched. `vf-licence`: 320, unchanged
except migration `0121`'s own coverage. `vf-app`: 1921, unchanged and
reconfirmed — `git status` shows zero files touched in that Worker
this phase, and the full suite was rerun anyway rather than taking
that on faith. `tsc --noEmit` clean in `vf-ui` and `vf-licence` once
the known `cloudflare:test`-under-bare-`tsc` noise is set aside (every
remaining line matches that class; none references anything this
phase touched). `eslint` clean, both the touched files and the whole
repository.

---

## What is not built

- **Phase 5**: retiring the old inline `<iframe>`/`<img>` preview and
  the raw-file `window.open` Expand. The second half of that is
  already done here, not phase 5's to do again — decision 0073's raw
  signed-URL `window.open` is gone, replaced by ordinary navigation to
  `document-window.html`. What phase 5 actually has left, re-checked
  against the design document's own section 5 rather than assumed: the
  *embedded* card's normal-state rendering (`buildDocTabs`, still
  drawn inline whenever no pop-out is open) is not "the old preview"
  phase 2 already replaced it — so phase 5, on the evidence here, may
  be smaller than its own name suggests, or may turn out to have
  nothing left once phase 4 is checked against it properly. Worth
  settling explicitly before starting it, not assumed from the design
  document's original five-phase list.
- **Annotation** (decision 0206), reachable since phase 2, still not
  attempted.
- **Safari and Firefox**, for the pop-out specifically — `window.open`
  named-window reuse is old, standard behaviour, not measured in
  either browser for this feature, matching decision 0380's own
  unmeasured caveat for the frame it replaced.
