# 0385 — Phase five had one thing left in it

**Status: built.** Phase 5 of `docs/design/document-viewer.md` — the
last phase in that design document.

---

## What was asked

The operator asked for a reminder of what phase 5 was, then asked to
have it settled: *"can you go dig through the codebase now and settle
it — confirm whether phase 5 is genuinely a no-op or find what's
actually left?"*

Phase 5, as the design document states it:

> Retire what phases 2 and 4 replace: the old inline
> `<iframe>`/`<img>` preview, and the raw-file `window.open` Expand.

Both halves of that sentence describe *behaviour* that decisions 0382
and 0384 already replaced, not left standing beside its replacement —
this is why the design document itself, updated at 0384, already
flagged this phase as possibly empty rather than assuming its original
five-phase wording still described real work.

---

## What was checked, and what was actually found

**The behaviour is genuinely gone, on both counts — checked, not
assumed.**

- `grep` across every browser-side source and test file for
  `openDocument`, `_blank`, and `noopener` — the old raw-file Expand's
  own signature — returns nothing. Decision 0384 replaced the function
  outright rather than leaving it dead beside its replacement.
- The Document tab's old `<img>`/`<iframe>` split has no surviving
  call site either: `showPreview()` calls `pageViewer()`
  unconditionally, the same as it has since decision 0382. The only
  `<iframe>` left anywhere in `viewer.js` is `documentFrame()`'s, which
  is the XML tab's own, still-live frame (decisions 0380 and 0382 both
  say explicitly that this one was deliberately kept) — not a second
  copy of what the Document tab used to do.

**One real leftover, found by checking the CSS the same way rather
than assuming it followed the JS.** `app.css` still carried:

```css
.vframe, .vimage { width: 100%; height: 100%; border: none; display: block; }
.vimage { object-fit: contain; background: var(--surface-0); }
```

`.vframe` is exactly the XML tab's own frame above — current, correct,
untouched. **`.vimage` styled the Document tab's `<img>` from decision
0123's original split, and nothing has created an element of that
class since decision 0382 replaced it with `page-renderer.js`'s
canvas.** Checked, not inferred from the name alone: zero references
anywhere in `public/*.js`, `public/*.html`, or `test-browser/*.ts`.
Decision 0382's own record described the CSS it *added* for the new
renderer and said nothing about removing what it made obsolete — the
rule simply outlived the tag it once styled, describing a shape
nothing draws.

Removed, with the surviving `.vframe` given the comment explaining
why it, and not `.vimage`, is still here.

**One more thing noticed and deliberately left alone.** `.vdoc .act {
width: 100%; }` in the same stylesheet also has zero references
anywhere in the codebase — but nothing ties it to this design document
or to either phase 2 or phase 4, and no comment anywhere attributes it
to a decision this session could check. Naming it here rather than
folding it into this phase's cleanup: it may be leftover from
something else entirely, and phase 5's own scope is specifically what
phases 2 and 4 replaced, not a general dead-CSS sweep.

---

## Tests

`app.css`'s own rule change is covered indirectly by every existing
test that reads the stylesheet through `virtual:stylesheets`
(decision 0124) — none asserts on `.vimage` by name, confirmed by
`grep` before removing it, so there was nothing to watch fail here.
Full suites, run together to be sure nothing else moved: **vf-ui**
browser 665/665 (unchanged from decision 0384 — this phase touched no
test file, only a stylesheet rule nothing tested), Worker 74/74
(unchanged). `tsc --noEmit` clean once the standing `cloudflare:test`
noise is set aside. `eslint` clean across the whole repository.

---

## What is not built

Nothing. This closes the five-phase plan `docs/design/document-viewer.
md` set out on 17 September: pages exposed (0381), rendered by a real
client-side renderer (0382), a hybrid PDF's embedded XML retained and
shown the same way bare XML is (0383), Expand opening a page of this
app rather than a raw file with one window enforced (0384), and now
this — confirming there was nothing behavioural left to retire, and
removing the one piece of CSS that still described what phase 2 had
already replaced.

Annotation (decision 0206), reachable since phase 2 and never
attempted in this arc, remains its own, later piece — named as such in
the design document's own section 6 from the start, never part of
this five-phase plan.
