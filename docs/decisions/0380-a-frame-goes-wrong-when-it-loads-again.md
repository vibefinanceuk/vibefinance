# 0380 — A frame goes wrong when it loads again, not when time passes

**Status: built.** Supersedes in part decision 0123's *"a frame left
open through a long keying session goes blank, and nothing refreshes
it."* Nothing refreshed it — and it does not go blank either.

---

## What was asked

A review of every past discussion of the document viewer came first:

> I wondered if you could review all past discussion about a document
> viewer?

Reading the records against `viewer.js` turned up a comment above
`showPreview()` that said something the code did not do:

> The URL expires in five minutes (decision 0073), so a frame left open
> through a long keying session goes blank. Refreshed when somebody
> returns to the tab, which is when they would notice.

Nothing in `vf-ui` listens for a tab becoming visible, or for focus, or
refreshes anything on a timer. Decision 0123 had listed exactly this as
**not built**; the comment written later claimed it was. The operator:

> yes, please do the preview-refresh bug and update the documents
> accordingly

---

## Measured before fixing — and the premise was wrong

The obvious fix is the one the comment described: when somebody comes
back to the tab, mint a new URL and point the frame at it. **Before
building that, the claim underneath it was tested**, because neither
0123 nor the comment had ever watched a frame go blank.

A local server stood in for `vf-app`'s `/documents/:token` — the same
headers (`inline`, `private, no-store`), and the same refusal once a
link has expired (403, `{"error":"document link expired"}`) — with a
three-second expiry instead of five minutes. A real Chromium
(Playwright, the full browser in headless mode, whose PDF viewer
renders) loaded a PDF in an `<iframe>`, a PNG in an `<img>` and an HTML
page in a second `<iframe>`, waited past the expiry, and then:

| After the link expired | Requests to the server |
| --- | --- |
| Hide the pane, show it again (what the tabs do, 0269) | none |
| Scroll the PDF | none |
| Resize the window | none |
| Switch to another tab and back | none |
| CSS zoom on the pane | none |
| Print media | none |
| **Move the frames elsewhere in the page** | **PDF and HTML, both expired** |
| **Reload the frame's own document** | **HTML, expired** |

**Time passing does nothing.** A frame that has loaded keeps its
document for as long as it is not asked to load again. The `<img>` was
never requested a second time in any row, including the move.

**And when it does load again, it does not go blank** — it shows
`vf-app`'s JSON error as text, in the middle of the viewer, which is
worse. A screenshot confirmed it.

Headless tab switching is an imperfect stand-in for a person leaving
the window, and only Chromium was measured — not Safari, not Firefox.
Both are recorded here rather than implied away.

### Why the obvious fix would have been a regression

Refreshing on returning to the tab — or on any timer — **reloads a
frame that was working.** A cross-origin frame's scroll position and
zoom cannot be read or restored from the parent, so every time
somebody came back from their ERP after five minutes, the PDF they had
scrolled to page three of would jump back to page one. To fix nothing:
the measurement shows returning to the tab never broke the frame.

---

## What was built

**`documentFrame()` in `viewer.js`: the frame's own `load` event is the
signal.** Any load the viewer did not cause itself — the browser
reloading the frame for whatever reason — gets a freshly minted URL.
The viewer's own loads (the first one, and each replacement) are
expected and ignored.

Both frames use it: the Document tab's preview (a PDF or a rendering)
and the XML tab (decision 0273), which re-mints with `type=original` so
a reload never swaps the original for the preferred document.

**Three things it deliberately does not do:**

- **No expiry arithmetic.** `document-url` returns `expiresAt`, and
  using it would mean trusting this machine's clock to agree with the
  one that signed the token, and a second copy of
  `TOKEN_TTL_SECONDS` in the browser to drift from the first. A frame
  that reloads while its link is still valid is minted one it did not
  need — one extra request, on an event the measurement found rare.
- **No retry when a mint comes back empty.** The document may no
  longer be retained, or the session may have ended — in which case
  every other action on the screen is about to fail too. The frame is
  left as it is.
- **Nothing for the `<img>`.** Nothing measured ever made an image ask
  for its URL twice. Handling an event that does not happen would be
  code nobody can watch work.

**It cannot loop.** The replacement URL is set by the viewer, so its
own load is the expected one — even if that load fails as well.

### Verified in the real browser, not only in `jsdom`

The function was then lifted verbatim out of `viewer.js` and run in the
same Chromium harness: the frames loaded, sat idle, were hidden,
scrolled and resized past their expiry with **no requests**; moved in
the page, each asked once with its expired link, was re-minted, loaded
the document again — and settled, with no further requests.

---

## Tests

`viewer.test.ts`, a new describe block, five tests driving the `load`
event by hand the way a browser would:

- a frame sitting there, a `visibilitychange` and a `focus` — **one**
  mint, not two;
- a load nobody asked for — a second mint, and the frame points at it;
- the second link's own load — no third mint; a later reload — a third;
- a second mint coming back empty — the frame keeps its first URL, and
  nothing retries;
- the XML tab's frame — re-minted, asking for `type=original`.

**Each watched fail.** Against the unfixed `viewer.js`, four of five
failed (the first passed, correctly — it guards against a refresh that
did not exist yet). With the `expectingLoad` guard removed, four failed
— every mint doubled. With a `visibilitychange` refresh added back in —
the shape the old comment described — the first test failed, `expected
[ …(2) ] to have a length of 1`.

vf-ui: 72 Worker tests (unchanged), 631 browser tests (was 626).
vf-app, vf-licence, shared: unchanged.

### And the browser suite has been exiting 1 all along

**Every browser test passes and `vitest` still fails the run.** It
catches **136 unhandled rejections** — before this change and after it,
the same 136 — and exits 1. Almost all are a test's own per-URL fetch
stub refusing a request the test never stubbed, thrown inside work the
viewer deliberately does not await: `/api/documents/:id/activity` from
`buildActivityTab()` (93, the one decision 0326 noticed as one that
*"occasionally surfaces"* — it surfaces every run) and
`/api/invoices/:id/document-url` from the preview (36), plus a handful
from the process-draft screen.

The per-package counts reported as passing through decision 0379 were
true of the tests and not of the run. **The same shape as decision
0100**: a check that printed the right-looking line while its exit code
said otherwise. Not fixed here — it is its own piece of work across
several test files, and this record is not the place to hide it inside.

---

## Also found, and corrected alongside

**Three comments in the viewer said things that stopped being true.**

- `openDocument()`'s own comment — *"Open the retained original in its
  own window"* — sat above `documentUrl()` instead, with a second
  comment written between it and the function it describes. Moved back.
- The seller card still carried *"Bottom right, like the document's own
  actions — decision 0228"* at the end of its children, where no button
  is. Decision 0228's own record moved Change Seller top right on the
  operator's reasoning — *"It might extend the card size if we place at
  the bottom right"* — and it lives in `cardHead()`. The comment now
  says so.
- `.vpreview`'s `calc(100vh - 300px)` (decision 0271) estimates the
  chrome around the image **including "the action row beneath it"**,
  which decision 0298 removed. The comment now records that; **the
  value is not changed** — how much space the image should take is a
  judgement for somebody looking at a live page, not one to guess at
  from a test runner.

**`SUPERSEDED.md` was missing records the review found reversed**, and
had one row naming the wrong record:

- decision 0267's drawer, replaced by 0269's tabs;
- decision 0122's footer row of actions, reversed by 0298;
- decision 0175's `Stage:` heading, replaced by 0312's `Unique Ref:`;
- decision 0105's *"`complete` is deliberately API-key only… that
  button belongs on the viewer"*, overtaken by 0138, after which every
  route accepts a session;
- the *"Which font?"* row credited the question to decision 0113, which
  is about code lists and never mentions a font. No record before 0124
  raises it; it was asked live, and 0124 quotes the asking.

**`PROGRESS.md` and `HANDOVER.md` had drifted too.** PROGRESS still
listed *"Publishing a process version… nothing creates a second
version"* under **Not built**, which decision 0349 built. HANDOVER's
*"Seven screens"* predates the Dashboard (0359) and Purchase Orders
(0371). And both give vf-app's test count as 1851: a clean run at
`46c1da2` counts **1893**, with no vf-app change since decision 0378
recorded 1851. **Why the two differ is not established** — recorded as
measured rather than explained after the fact.

**`docs/design/mockups/README.md` still opens "Nothing here is
built"**, true when written. A note now points at what was.

---

## What is not built

- **Same-origin delivery, measured pagination and annotation**
  (decision 0206) — the operator's own end goal for this frame since
  0123, still one piece of work, and untouched here.
- **An in-app message when a mint fails**: the frame keeps whatever the
  browser last showed, which after an expiry is the JSON error.
- **A measurement in Safari or Firefox.** The fix does not depend on
  which browser reloads a frame, only on the `load` event every browser
  fires — but the claim that time alone does nothing is Chromium's.
