# 0462 — `.readonly` Is a `<div>`, Not an `<input>`, and `box-sizing` Never Reached It

**Status: confirmed pushed and deployed.** `origin/main` fetched
directly reads `1b64da3`, matching this session's own commit exactly,
and the operator confirmed with *"deployed and pushed."* No
migration — `vf-ui` only.

---

## What was reported

Live, once decision 0461 shipped, with two screenshots: *"deployed and
pushed - the Org / Company Code field is way out of line again. It
spills out of the page...."* The screenshots show it wider than the
search boxes beneath it and running past the pop-out's own right edge
— the pop-out itself scrolling horizontally to show the rest of it.

## The actual root cause, finally

Decision 0460 gave `.codingcompanycode` `width: 66.6667%`, matching
`.codingsearch`'s own fraction. Decision 0461 gave it `width: 100%` of
the same shared grid column `.codingsearch` resolves to. **Both times
the number matched exactly, and both times the rendered box was still
wider** — because `width` does not mean the same thing on the two
elements.

`.codingsearch .searchbox` is a real `<input>`. `tokens.css` gives
every `input:not([type="checkbox"]):not([type="radio"]), textarea` its
own `box-sizing: border-box` — a real rule, just never named in either
of the last two decisions because neither one had reason to look at
`tokens.css`. `.codingcompanycode` is a `<div class="readonly
codingcompanycode">`. `.readonly` (decision 0402) gives it
`padding: 8px 11px`; nothing gives it `box-sizing: border-box`, so it
keeps the browser's own default, `content-box`. A content-box element
with `width: 100%` and 22px of its own horizontal padding renders at
**the column's own width plus 22px** — not the column's width. The
`<input>` renders at exactly the column's width, because its own
padding is already inside that number.

Two elements, two box models, one property name that means two
different things — the actual reason this kept drifting even after
0461 made the two `width` declarations byte-for-byte identical.

## The fix

```css
.popout.codingpopout .codingcompanycode {
  box-sizing: border-box;
  min-height: 38px;
  width: 100%;
}
```

One property, on the one element that needed it. `box-sizing:
border-box` is not touched on the shared `.readonly` rule itself —
every other screen's read-only box has no explicit `width` on it, so
this was invisible everywhere else; changing the shared rule for one
popout's own sake risked exactly the kind of action-at-a-distance this
project has caught and reverted before. Scoped to
`.popout.codingpopout .codingcompanycode` the same way `min-height:
38px` already was.

## Verified against the real, unmodified files, not a mock-up

Rendered `tokens.css` + `app.css` + the real popout markup headless,
dark mode, and read the actual laid-out geometry rather than eyeballing
a screenshot:

- `.codingcompanycode`: `left 435.5, right 668.5, width 233, height 38`
- `.codingsearch` (Cost Centre): `left 435.5, right 668.5, width 233, height 40.5`
- `.popout`: `scrollWidth === clientWidth` (469 both) — no horizontal
  overflow, the exact failure just reported.

Both boxes now share the identical left and right edge. The 2.5px
height difference (38 vs. 40.5) is `.codingsearch`'s own `align-items:
start` grid sizing to its tallest cell content, not a mismatch worth
chasing further — well inside what reads as "the same height" next to
`.readonly`'s explicit 32px-vs-38px gap this whole thread started from.

`workers/vf-ui`: full `viewer.test.ts` run in isolation — **175/175
passed**, the pre-existing `document-window.test.ts`-shaped
unhandled-rejection flake at its usual baseline (145 non-fatal
errors), none a failing assertion; no test asserts a computed pixel
width, so none needed touching. `npx tsc --noEmit`: the same
repo-wide, pre-existing 753-line baseline — CSS only, no TypeScript
touched.

## What this means for the rest of `.readonly`

Nowhere else in the app puts an explicit percentage or `100%` width on
a `.readonly` div today — checked directly before writing this off as
scoped. If a future screen ever does, it will hit the identical
content-box-vs-border-box gap; worth a one-line callout in
`.readonly`'s own doc comment (decision 0402) rather than a code
change, since there is still nothing live for a shared rule to fix.

## Still to do, operator side

All done — `wrangler deploy` confirmed for `vf-ui`, no migration to
apply this time, in the operator's own single report: *"deployed and
pushed."*
