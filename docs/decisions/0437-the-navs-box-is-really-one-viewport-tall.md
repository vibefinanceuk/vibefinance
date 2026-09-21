# 0437 — The nav's box is really one viewport tall, and doesn't scroll sideways

**Status: built, tested, documented. Not yet pushed or deployed** —
this session still has no push access to `vibefinanceuk/vibefinance`;
delivered as a git bundle for the operator's own pull/push/deploy
sequence, the same path decisions 0391, 0415–0436 already used.

---

## What was found

Decision 0436 shipped, and the operator reported no change:
*"that doesn't seem to have worked... I still have to scroll down the
page to see the username and instance."* A second report followed:
*"Now there seems to have been introduced a horizontal scrollbar which
is not needed."*

Both were checked live rather than assumed — signed in through the
built-in browser at a genuine desktop width (1600×1000), with the
computer's own developer tools reached programmatically.

**Decision 0436's own diagnosis was wrong.** It read `.nav`'s rendered
height (1040px against a 1000px box) as `.navscroll`'s content
overflowing its allotted space, and built a scrolling wrapper to
contain it. The live re-check found the opposite: `.navscroll`'s own
`scrollHeight` and `clientHeight` were identical (952px each) — its
content fit with zero overflow. The 1040px was never content; it was
`.nav`'s own `padding: 20px 12px`. `height: 100vh` sets the CONTENT
box under the default `box-sizing: content-box`, and padding is added
on top of that — so `.nav`'s rendered box was always 100vh + 40px,
regardless of how much was inside it. Measuring `.nav` before and
after decision 0436 deployed gave identical numbers (`rect.height:
1040`, `who.rect.bottom: 1052`) — the wrapper genuinely changed
nothing about the geometry the operator was looking at, which is
exactly what a live before/after comparison should have caught before
shipping it, and didn't.

**The horizontal scrollbar is a real, if smaller, regression from
0436's own change.** `.navscroll { overflow-y: auto }` left
`overflow-x` unset, at its default `visible`. The CSS Overflow
specification does not allow one axis to stay `visible` while the
other is set to anything else — it requires the UA to promote the
`visible` axis to `auto` too. Live inspection confirmed exactly this:
`getComputedStyle(navscroll).overflowX` read `"auto"` despite nothing
in this codebase setting it. A small, pre-existing horizontal overflow
in the nav column (`scrollWidth: 200` against `clientWidth: 176`) —
harmless before, since `overflow-x: visible` just let it render past
the edge without a scrollbar — became a visible scrollbar the moment
`overflow-x` was silently promoted.

## What was built

`.nav` gets `box-sizing: border-box`, so its explicit `height: 100vh`
means the whole rendered box, padding included, rather than the
content box alone with padding added on top. This is the fix for the
reported symptom: it makes `.nav`'s own box actually one viewport
tall, which decision 0281's own `position: sticky; top: 0` needs to be
true for `.who` to reach the visible bottom edge once the nav sticks.

`.nav .navscroll` gets `overflow-x: hidden`, stated explicitly rather
than left for the specification's own axis-promotion rule to decide.
This is the fix for the new complaint, and the standard pairing for
any `overflow-y: auto` rule that was never meant to scroll sideways.

Decision 0436's own `.navscroll` wrapper and its `overflow-y: auto;
min-height: 0` were left in place — not because they were the fix
this symptom needed, but because the protection they offer against a
genuinely longer nav list someday outgrowing its box is still real,
independent of what caused this particular report. Its own comment in
`app.css` was corrected in place to say so plainly, rather than left
to mislead the next person who reads it.

**What this does not fully close.** The page's own `body { padding:
2rem 1rem }` (from `tokens.css`, 32px top) still means `.nav`'s
*natural*, un-stuck position starts 32px below the actual top of the
viewport — so on a page load at the very top of the scroll position,
before any scrolling has happened, `.who` can still sit roughly 32px
below the fold until the user scrolls past that amount and `position:
sticky` engages. That is a much smaller version of the same shape of
problem (32px now, versus the up-to-72px this decision closes, versus
however far down a long document ran before decision 0281 existed at
all) but it is not zero. Closing it fully would mean moving `.nav`
out from under `body`'s own padding — a `margin-top: -32px` bleed, or
a structural change — which was not attempted here: it could not be
verified live (the device connection dropped mid-investigation, before
this fix was written), and a change to `.nav`'s own position relative
to the rest of the page is exactly the kind of thing that needs a
screenshot, not just arithmetic, before it ships. Left as a known,
named gap rather than guessed at.

## Tests

`workers/vf-ui/test-browser/tasks.test.ts` — new describe block, "the
nav's own box is really one viewport tall, and doesn't scroll sideways
(decision 0437)," 2 tests: confirms `.nav`'s own wide-layout rule
carries both `height: 100vh` and `box-sizing: border-box`; confirms
`.nav .navscroll` carries `overflow-x: hidden`.

**Suite state:** `vf-app` unchanged at 2490. `vf-ui` browser 956 →
**958** (+2, this decision's own new tests). `vf-ui` Worker unchanged
at 74. `vf-licence` unchanged at 320. Full `vf-ui` suites (Worker and
browser) re-run, all green. `eslint public test-browser` clean.

## What is not built

**The remaining ~32px initial-load gap**, named above under "What this
does not fully close." A candidate fix (`margin-top: -32px` on `.nav`,
to cancel `body`'s own top padding for this one element) was
considered and deliberately not shipped without a live visual check —
untested changes to a sticky sidebar's own position relative to the
rest of a hand-tuned layout are exactly where "the arithmetic says
it's fine" has burned this project before (0281's own history, this
decision's own history). Next session, or this one once the device
reconnects, should verify it live before writing it.
