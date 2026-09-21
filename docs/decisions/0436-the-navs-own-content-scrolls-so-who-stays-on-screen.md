# 0436 — The nav's own content scrolls, so `.who` stays on screen

**Status: built, tested, documented. Not yet pushed or deployed** —
this session still has no push access to `vibefinanceuk/vibefinance`;
delivered as a git bundle for the operator's own pull/push/deploy
sequence, the same path decisions 0391, 0415–0435 already used.

---

## What was asked

> I wondered if the height of the side menu alone can resize to the
> height of the browser window, so the username and instance, which
> appear at the bottom can always be seen on-screen?

## What was found

This reads like decision 0281 — *"align the side panel bottom, with
the bottom of the browser size... this will ensure that user, and
instance are always visible, and not hidden from view"* — restated,
and the code for it is already there: `.nav` has been `position:
sticky; height: 100vh; align-self: start` since that decision. So
before touching anything, this was checked live rather than assumed
fixed or assumed broken.

A hard refresh was ruled out first (ruled out directly by the
operator). Signed in through the built-in browser at a genuinely
desktop width (1600×1000, not the preview pane's own narrower default,
which triggers decision 0281's *other*, intentional behaviour — the
nav becomes a horizontal bar below 1100px and hides `.who` entirely,
by design, on a different axis from this bug), `.nav` itself measured
exactly as decision 0281 intended: `position: sticky`, a `1000px`
computed height. But its own rendered content — logo images plus every
`.navgroup` and `.navitem` — measured **1040px**, forty pixels taller
than the box holding it. `overflow: visible` (the default, and never
overridden) let that forty pixels bleed straight past `.nav`'s own
bottom edge, which is exactly where `.who` sits.

**Decision 0281 capped the box; nothing capped what went inside it.**
Three more configuration screens — Purchase Orders, Rules, Processes —
joined the nav after 0281 shipped, each one a real, wanted addition
that nobody had reason to re-check against a fixed-height sidebar at
the time. The nav's own content simply grew past one viewport's
height, quietly, the same way `.main`'s content once did before 0281 —
a different instance of the same shape of bug: something meant to be
a fixed pane, sized only for what it held on the day it was fixed, not
for what it would hold later.

## What was built

`tasks.js`'s `navEl` now wraps everything above `.who` — the three
logo images and every `.navgroup`/`.navitem` `navItems` produces — in
a new `.navscroll` div. `.who` stays exactly where decision 0281 left
it: a direct child of `.nav`, a sibling of `.navscroll` rather than
nested inside it, still relying on its own `margin-top: auto` to sit
at the bottom of `.nav`'s box.

In `app.css`, `.nav .navscroll` gets `flex: 1 1 auto; min-height: 0;
overflow-y: auto` in the wide layout. `min-height: 0` is the line that
actually matters — a flex item's default `min-height: auto` means "at
least as tall as my content," which silently defeats `overflow-y` no
matter what it's set to; this is the same category of "the rule was
there but something else won" decision 0281 itself named once already
about `align-self: start`.

The narrow-screen media query (below 1100px, where `.nav` is a
horizontal bar and `.who` is already hidden by decision 0281) gets
`.nav .navscroll { display: contents; }` — removes the wrapper from
the box tree entirely, so its children rejoin `.nav`'s own flex row
exactly as they were before this wrapper existed, rather than the
wrapper becoming an unwanted single flex item there.

**What this does not change**: `.nav`'s own box is still exactly one
viewport tall, still pinned to it — decision 0281's fix is untouched.
This decision only stops the nav's own *content* from being able to
push past that box's edge, regardless of how many screens are added
to it in the future.

## Tests

`workers/vf-ui/test-browser/tasks.test.ts` — new describe block, "the
nav's own content scrolls independently of .who, once there's enough
of it (decision 0436)," 3 tests: confirms the DOM wraps the logo and
every real nav item inside `.navscroll` with `.who` left outside it
(a direct sibling, not nested); confirms `.nav .navscroll` carries
`overflow-y: auto` and `min-height: 0` in the wide-layout stylesheet
text; confirms the narrow-screen media query carries `.nav .navscroll
{ display: contents; }`.

One pre-existing test needed updating, not because it was wrong but
because the DOM it was asserting against genuinely changed: "the brand
mark (decision 0145) — sits at the head of the column, above the
navigation" queried `.nav`'s own direct `.children` for the brand mark
and the first nav link, both of which now live one level deeper, in
`.navscroll`. Repointed at `.nav .navscroll`'s own children instead —
the property being asserted (the mark comes before the links, in DOM
order) is unchanged; only where that ordering now lives moved.

**Suite state:** `vf-app` unchanged at 2490. `vf-ui` browser 953 →
**956** (+3, this decision's own new describe block). `vf-ui` Worker
unchanged at 74. `vf-licence` unchanged at 320. Full `vf-ui` suites
(Worker and browser) re-run, all green — including the pre-existing
"brand mark" test, updated and passing against the new structure.
`eslint public test-browser` clean.

## What is not built

**No visual smoke test of the exact pixel measurements found live**
(1040px content in a 1000px box). Nothing here asserts a specific
overflow amount — the fix removes the ceiling on how much nav content
can exist without breaking `.who`'s visibility at all, rather than
tuning for today's particular overflow, which would only need
re-tuning again the next time a screen is added.

**No scrollbar styling.** `.navscroll` uses a plain `overflow-y: auto`
with the browser's own default scrollbar, matching every other
`overflow-y: auto` rule already in this file (`.permissiongroups.
scrollable` among them) — there is no established scrollbar-styling
convention in this codebase to depart from.
