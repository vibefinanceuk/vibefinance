# 0438 — The nav is flush with the top of the viewport from the very first paint

**Status: built, tested, documented. Not yet pushed or deployed** —
this session still has no push access to `vibefinanceuk/vibefinance`;
delivered as a git bundle for the operator's own pull/push/deploy
sequence, the same path decisions 0391, 0415–0437 already used.

---

## What was found

Decision 0437 fixed `.nav`'s own padding overshoot (`box-sizing:
border-box`) and the horizontal scrollbar, but named a gap it
deliberately did not close: *"`body`'s own top padding (32px) still
leaves `.nav`'s natural, un-stuck position 32px below the true top of
the viewport, so a small scroll can still be needed immediately on
page load before `position: sticky` engages... deliberately not
shipped without a live visual check — the device connection dropped
mid-investigation before it could be verified."*

The device connection came back this session. Rather than leave the
gap open, it was checked properly this time: the candidate fix
(`margin-top: -32px` on `.nav`) was live-patched onto the still-
deployed page (decision 0436's own code, since 0437 had not yet
reached production) and measured directly, before writing anything to
source.

**Unpatched**: `.nav`'s rendered box measured `top: 32, bottom: 1072`
(the 0437-diagnosed 40px padding overshoot plus this 32px gap,
combined); `.who`'s own bottom sat at `1012`, twelve pixels below a
1000px viewport, at scroll position zero.

**Patched** (`box-sizing: border-box` from 0437, plus `margin-top:
-32px`): `.nav`'s rendered box became `top: 0, bottom: 1000` — exactly
one viewport, flush at the very top. `.who`'s own bottom moved to
`980`, fully within the viewport, with **no scrolling at all**.

**Confirmed the fix doesn't disturb anything else.** `.topbar`
(`.main`'s own content, sharing the page with `.nav`) measured
identically before and after — `top: 54` in both cases. A negative
margin on a CSS Grid item shifts that item within its own track
without affecting sibling tracks, and this confirmed it rather than
assumed it. A screenshot of the patched page was also taken and
reviewed: the nav's own logo sits close to the top edge with no
visible overlap or misalignment against the main content's own
heading.

## What was built

`.nav` gets `margin-top: -32px` in the wide layout — exactly
cancelling `body`'s own `padding: 2rem 1rem` (`tokens.css`, 32px at
the standard root size) for this one element, so `.nav`'s natural,
un-stuck position is already flush with `top: 0` from the very first
paint, rather than only reaching it once scrolling engages `position:
sticky`.

The narrow-screen media query (below 1100px, where `.nav` becomes a
horizontal bar in normal flow) gets `margin-top: 0`, resetting it —
this correction exists only for the wide, sticky sidebar; the narrow
layout needs no compensation and should sit exactly where normal flow
puts it, like everything else on the page at that width.

**Coupled to `body`'s own padding value by a literal number, not a
shared variable** — `tokens.css` defines no custom property for it.
Stated plainly in `app.css`'s own comment: if that padding ever
changes, this number needs to change with it.

## Tests

`workers/vf-ui/test-browser/tasks.test.ts` — new describe block, "the
nav is flush with the top of the viewport from the very first paint
(decision 0438)," 2 tests: confirms the wide-layout `.nav` rule
carries `margin-top: -32px`; confirms the narrow-screen media query
resets it to `margin-top: 0`.

**Suite state:** `vf-app` unchanged at 2490. `vf-ui` browser 958 →
**960** (+2, this decision's own new tests). `vf-ui` Worker unchanged
at 74. `vf-licence` unchanged at 320. Full `vf-ui` suites (Worker and
browser) re-run, all green. `eslint public test-browser` clean.

## What is not built

**Nothing named as outstanding.** This decision was written
specifically to close the one gap decision 0437 left open, and it
was verified live — against the actual deployed page, not just
arithmetic — before being written to source, which is the check 0437
itself was unable to perform in time. If the operator still sees any
scroll-before-visible behaviour after this deploys, that would be a
new, different symptom, not a residue of this one.
