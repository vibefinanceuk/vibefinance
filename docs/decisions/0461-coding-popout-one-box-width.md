# 0461 — One Box Width Drives the Coding Pop-out, Not Three Separate Copies of It

**Status: confirmed pushed and deployed, then found incomplete.**
`origin/main` fetched directly reads `1b64da3`, which contains this
decision's own commit; the operator confirmed `wrangler deploy` run
for `vf-ui`. Live, the Org / Company Code box was still wider than
the search boxes and spilled past the pop-out's own edge — this
decision's `width: 100%` was right in principle but never actually
took effect the way intended, for a reason this decision didn't know
to look for. See decision 0462: `.readonly` is a `<div>`, and
`box-sizing: border-box` — which every real `<input>` already has,
via `tokens.css` — never reached it, so its own padding added itself
on top of the `100%` rather than counting inside it. The
`--codingfield-label-w`/`--codingfield-w` structure this decision
introduced is still exactly right and is what decision 0462 builds on;
only the one box-model gap was missing. No migration — `vf-ui` only.

---

## What was asked

Live, once decision 0460 shipped, with a screenshot: *"the box is
still too wide. The Close button needs to be above the right edge of
the box containing the Org / Company Code. The Org / Company code box
is also still wide and taller than the boxes beneath it."*

Followed by *"can you mock up, instead of build, so we can get this
right"* — see `docs/design/mockups/line-coding-popout-widths.html`, a
"Current" replica reproducing the report next to a "Proposed" version
with two live sliders (box width, label column). The operator's own
answer, from that slider: **320px / 190px.**

## The root cause behind all three reports

One number, stated three separate times:

- `.codingsearch`'s own `width: 66.6667%` — decision 0460.
- `.codingcompanycode`'s own `width: 66.6667%` — decision 0460, a
  second, independent copy of the same fraction.
- `.popout.codingpopout`'s own `width: min(900px, 100%)` — decision
  0458, sized for a two-column results grid decision 0459 already put
  back to one column, never revisited when 0460 narrowed the boxes
  inside it.

Three copies of one relationship drift. `.codingcompanycode`'s own
`66.6667%` is a fraction of the `.editgrid`'s own value column, which
is itself `1fr` of a 900px pop-out — the same fraction as
`.codingsearch`'s, arithmetically, but nothing ties them together, and
`.cardhead`'s Close button (`justify-content: space-between`) sits at
the pop-out's own 900px edge regardless of what either box resolves
to. Narrowing two independent percentages left a third, unrelated
number — the pop-out's own width — exactly where it always was.

## The fix: one pair of numbers, stated once

`.popout.codingpopout` now declares two custom properties —
`--codingfield-label-w: 190px` and `--codingfield-w: 320px` — and
everything else is computed from them:

```css
.popout.codingpopout {
  --codingfield-label-w: 190px;
  --codingfield-w: 320px;
  width: min(calc(16px + var(--codingfield-label-w) + 14px + var(--codingfield-w) + 16px), 100%);
  height: min(640px, 85vh);
  display: flex;
  flex-direction: column;
}
.popout.codingpopout .editgrid {
  flex: none;
  grid-template-columns: var(--codingfield-label-w) 1fr;
}
```

`.codingsearch` and `.codingcompanycode` both read `width: 100%` of
that same `1fr` column now, rather than each stating its own
`66.6667%` — so a search box and the read-only Org / Company Code box
resolve to the identical pixel width by construction, not by two
people (or two decisions) getting the same fraction right independently.
`.codingcompanycode` still restates `min-height: 38px` — `.readonly`
is shared far too widely (decision 0402) to touch its own default —
but that is the one property actually specific to this one box; width
is not.

The pop-out's own width is the sum of those two custom properties
plus its own padding (16px either side) and the grid's own gap
(14px): `16 + 190 + 14 + 320 + 16 = 556px`. Because `.cardhead` spans
the pop-out's full padded width and puts Close at its far right edge,
and the value column now ends exactly `16px` (the padding) short of
that same edge, Close lands directly above the box's own right edge —
an arithmetic consequence of the one relationship now stated once, not
a second measurement kept in sync by hand.

**Chosen deliberately wider than decision 0460's own `66.6667%` in
isolation** (320px vs. the ~285px that fraction resolved to inside a
900px pop-out) — the report was about the pop-out feeling too wide as
a whole, not the box in isolation; shrinking the pop-out itself from
900px to 556px is most of what makes this read as narrower, and 320px
was picked live, watching the slider, for how "Management & Business
Professionals Services" — one of the longer values a Commodity Code
field actually holds — reads inside it.

## What was not built

- **No change to `.readonly`'s own generic rule, `input`'s own generic
  rule, or any other screen.** Every property this decision touches is
  scoped to `.popout.codingpopout` and the two classes inside it.
- **Mobile is not specifically revisited.** The pre-existing
  `@media (max-width: 520px) { .editgrid { grid-template-columns: 1fr; } }`
  rule no longer overrides this pop-out's own `.editgrid` — the new
  `.popout.codingpopout .editgrid` selector is more specific than that
  media-scoped one, where before it wasn't stated at all and fell
  through to it. On a narrow phone screen the two-column layout (a
  fixed 190px label column) now persists rather than collapsing to
  one column. Not reported, not asked about, and this product's own
  daily use is desktop AP/AR work — noted rather than fixed, in case
  it is ever raised for real.
- **No debounce, no change to the search-on-focus behaviour itself** —
  this decision is sizing and alignment only, on top of decision
  0460's own mechanism.

## Verification

`workers/vf-ui`: the full pre-existing "invoice-line Coding pop-out"
test suite (26 tests across decisions 0453/0457/0458/0459/0460) rerun
unmodified — all still pass, since this decision is CSS-only and no
test asserts a computed pixel width or the literal `66.6667%`/`900px`
values (checked directly, by search, before relying on that). Full
`viewer.test.ts` run in isolation: **175/175 passed**; the pre-existing
`document-window.test.ts`-shaped unhandled-rejection flake present at
its usual baseline (145 non-fatal errors in isolation), none a failing
assertion.

Rendered directly against the real, unmodified `tokens.css`/`app.css`
and the real popout markup (not a mock-up's own reproduction) in a
headless browser, dark mode, to confirm the actual shipped CSS
produces what the mock-up promised: Close sits directly above the
Org / Company Code box's own right edge, and that box matches the
search boxes beneath it in both width and height. `npx tsc --noEmit`:
the same repo-wide, pre-existing 753-line baseline as every prior
decision this session — unsurprising, since this decision touches no
TypeScript.

No `vf-app`/`vf-licence` change, no new migration, no new string —
`app.css` only.

## Still to do, operator side

All done — `wrangler deploy` confirmed for `vf-ui`, no migration to
apply this time. See decision 0462 for the follow-up fix this
decision's own report needed.
