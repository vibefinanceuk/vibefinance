# 0390 — Three fifths, two fifths, and a freed rail

**Status: built.**

**Superseded in part by decision 0391**, on one specific point: the
"What was built" section below calls `.vpreview`'s leftover
`min-height: 320px` "still the floor for a card genuinely given less
than that." Once the Document card was actually capped below 320px on
some invoices, that floor did what a floor does and pushed the
preview past its own card's bottom. Everything else here stands.

---

## What was asked

> so roughly the buyer card, seller card and document image card each
> occupy a third of the available space. How would that look if the
> buyer and seller card shared 3/5 of the available space, and the
> document image card occupied 2/5 of the available space?

Mocked up both — the current 2fr:1fr split (each card roughly a
third) beside a 3fr:2fr one — and measured rather than eyeballed:
733px/367px before, 660px/440px after, on the same 1116px-wide render.
Approved: *"I like this balance, please can you implement."*

Alongside it, two further asks in the same message:

> Also, please can you fill the document image card with all
> available space so that the card space is maximized with the
> document image. Furthermore, the document image thumbnail can be
> hidden when the card is docked in the validation page. Should the
> user wish to view thumbnails then they can Expand the card into a
> separate window.

---

## What was built

**The 3:2 split.** `#viewer .columns` (decision 0388's own, more
specific rule, already scoped away from the Sources screen's shared
`.columns`) gains `grid-template-columns: minmax(0, 3fr) minmax(0,
2fr)`, overriding the base rule's `2fr 1fr` for this screen only.
Measured on the real page: Seller/Buyer combined 660px, Document
440px — a 3:2 ratio, not approximated.

**The Document card filling its own space, checked rather than
assumed.** Measuring the *current* layout, before touching anything,
`.vpreview` computed to exactly `320px` tall — its own `min-height`,
a floor written for the pre-0388 layout (decision 0271) and never
revisited once decision 0388 made the card's height a function of the
grid instead of the viewport. The reason: `.c-document .vpreview {
height: auto; }`, added by 0388, sits on a plain block element whose
direct parent (`normalBody`, matched by `.c-document > .panel > *:not(.cardhead)`)
already has a real, flex-computed height — `auto` never asks for it,
sizing to content instead, and an empty or not-yet-drawn preview has no
content to size to. Changed to `height: 100%`, which now resolves
against that real parent height instead of collapsing to the floor —
confirmed by measuring `.vpreview`, `.vpagesroot`, `.vmain` and
`.vcanvasholder` before and after: all four now report a real,
filled height matching what the card was actually given, not a fixed
320px regardless of it. `.vpreview`'s own `min-height: 320px` is
untouched — still the floor for a card genuinely given less.

**The thumbnail rail, docked.** `page-renderer.js`'s own `rail.hidden
= pages.length <= 1` is untouched — a single-page document still
hides it exactly as before, and the pop-out window (`#docwindow-root`,
decision 0384) still shows it for a multi-page one exactly as before.
A second, independent rule — `#viewer .vrail { display: none; }` —
hides it specifically where this is docked, regardless of page count,
matching the request directly: thumbnails only in the pop-out.
`.vmain`'s existing `flex: 1` picks up the freed 92px + gap
automatically once the rail leaves the flex flow; nothing else needed
changing for the canvas area to use the full card width.

---

## Tests

None needed changing. Nothing in the suite asserted on `.columns`'s
`grid-template-columns` value, `.vpreview`'s computed height, or
`.vrail`'s CSS `display` — `page-renderer.test.ts`'s own rail tests
check the `.hidden` **property** `pageViewer()` itself sets, which
this change does not touch, confirmed by rerunning the full suite
rather than assumed untouched. Decision 0281's own brace-counting nav
test (the hazard decision 0388 first ran into) still passes — these
rules landed inside the viewer's own, later `@media (max-width: 1100px)`
block, not the shared one it slices.

vf-ui: 74 Worker, 666 browser, all passing. No migration, no other
Worker — `app.css` only.

---

## What is not built

A second, smaller whitespace source — noted while investigating this
request, not asked to be fixed here — remains: `.c-parties` (the grid
area) still measures taller than `.parties` (the element actually
filling it) by about 36px, because the Document card's own natural
content height, spanning the process/parties/header rows, is slightly
taller than those three rows' own combined natural height, and the
grid gives the surplus to the flexible parties row. It shows as a
somewhat larger gap below the Seller/Buyer cards, not inside them, and
is independent of everything built here.
