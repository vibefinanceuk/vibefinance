# 0391 — The Document card stops borrowing space

**Status: built.** Supersedes part of decision 0390's own reasoning
about `.vpreview`'s `min-height: 320px`.

---

## What was asked

> The document viewer should be capped at the height of the Process
> card, plus Seller / Buyer card, plus Invoice Header card. As
> observed in the attached image - when I zoom into the invoice image
> in the document card, it increases the size of the box in which it
> exists. This creates large padding / space between the cards on the
> left of the image. Here are two images, one not zoomed, and a
> second zoomed in. When zoomed in, the invoice should zoom within
> the cards allowable space, without expanding the size of the card
> to result in these padding between cards. Does that make sense?

And, mid-turn:

> Note - it may be necessary to add scroll bars on the invoice image
> when zoomed to allow the user to scroll to a specific part of the
> zoomed image

---

## The premise, checked before building anything

Reproduced first, rather than guessed at: a harness with a genuinely
tall test image (`page-renderer.js` draws the canvas at the image's
own native size × zoom — not scaled to fit — so a tall enough native
image, or enough zoom on a modest one once it exceeds the container's
width and `max-width: 100%` starts clamping it, both land in the same
place) reliably grew `.c-process`, `.c-parties` and `.c-header` — not
just the Document card — measured 130px → 342px, 339px → 550px, 205px
→ 416px respectively for one such case. **CSS Grid's own "increase
sizes to accommodate spanning items" step** is why: `document` spans
those three rows, and per spec that step runs for any track whose max
sizing function isn't a fixed length — `auto`, `min-content` and
`max-content` are all eligible, confirmed by trying `min-content`
explicitly on those rows and watching the same inflation happen
regardless. There is no track-sizing keyword that lets a spanning
item's own content need more room without some of its spanned tracks
growing to give it that room — this is not a bug in decision 0388's
own CSS, it is what asking a grid to do this at all costs.

## What was built

**`.c-document` taken out of the sizing algorithm entirely**, the one
technique that actually stops a spanning item's content from
influencing shared tracks: `position: absolute` on a grid item removes
it from the track-sizing algorithm altogether, while its resolved
`grid-area` still becomes its containing block, so `inset: 0` still
fills exactly the area `grid-area: document` describes — now sized
purely by `process` + `parties` + `header`'s own natural rows, exactly
as asked. `#viewer .columns` gained `position: relative` (an
abs-pos grid item without a positioned ancestor upward would fall back
to the initial containing block instead of its grid area — checked by
trying it without this and watching `.c-document` size itself to the
whole viewport).

**A second, real regression this same fix opened, found immediately
by re-measuring rather than assumed clean:** with the Document card
now genuinely capped, decision 0390's own `.vpreview { height: 100%;
}` started resolving against a parent shorter than 320px on some
invoices — and the *base* rule's leftover `min-height: 320px` (decision
0271) then won, growing `.vpreview` past its own container's bottom.
`overflow: hidden` on `.vpreview` clips its own children, not itself,
so it simply spilled out of `normalBody` and every ancestor above that
doesn't clip either — visible as the Document card overlapping the
Lines panel beneath it. `#viewer .c-document .vpreview` gained
`min-height: 0` alongside 0390's `height: 100%` — the floor decision
0390 called "still fine to leave" is exactly what this decision's own
premise rules out: a card that is never taller than the rest of the
row, however little room that leaves the preview.

**Scrolling, asked for separately, turned out to already exist.**
`.vcanvasholder { overflow: auto; }` has been there since decision
0382 — once the box itself stops growing to swallow the overflow,
that pre-existing rule is what shows a scrollbar and lets the zoomed
image be scrolled to any part of itself. Measured directly:
`scrollHeight` genuinely exceeds `clientHeight` once zoomed, and
setting `scrollTop` programmatically moves it. Nothing new needed
building for this half of the request.

**The narrow-screen stack, checked and found broken by the same fix,
then reset.** At `max-width: 1100px` (decision 0388's own single-
column fallback), `document` no longer shares its row with anything —
it is the only thing in it. Taking it out of the sizing algorithm
there left that row with nothing else to size itself by at all,
measured collapsing to `0`. `.c-document { position: static; }` inside
that same media query — already the block that resets this card back
to its own honest, viewport-driven height for the narrow case — is
where the reset belongs.

---

## Tests

None needed changing — nothing in the suite asserts on `.c-document`'s
`position`, on `.vpreview`'s `min-height`, or on any pixel height in
this chain. Full suites: vf-ui 74 Worker + 666 browser, both passing,
rerun rather than assumed after every step above, including decision
0281's own fragile nav test. No migration, no other Worker.

## What is not built

Whether zooming in on an invoice already wider than its container
should visibly enlarge it further, beyond drawing at a higher
resolution behind the same fixed window — noticed while reproducing
this, not asked about, and a question about the zoom control's own
feel rather than about the layout bug this decision fixes.
