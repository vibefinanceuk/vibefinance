# 0281 — The nav, pinned to the window rather than stretched by the page

**Status: built.**

---

## What was asked

> Please can you align the side panel bottom, with the bottom of the
> browser size. this will ensure that user, and instance are always
> visible, and not hidden from view.

## Why it was hidden

`.frame` is a CSS grid row, and a grid cell stretches to match its
row's own height by default. `.nav`'s height was never set explicitly —
it simply matched whatever `.main` grew to. On any screen tall enough
that `.main`'s own content (a long form, a document, a wide table)
pushed the page past one viewport, `.nav` grew exactly as tall, and
`.who`'s own `margin-top: auto` pushed the signed-in name and
environment to the bottom of *that* height — which could sit well
below the visible window, reachable only by scrolling past whatever
was in the main column.

## The fix

`.nav` is now `position: sticky; top: 0;` with an explicit
`height: 100vh`, so it holds exactly one viewport's height and stays
pinned to the browser window as the page scrolls, rather than
stretching to match the page beneath it.

**`align-self: start` is what makes the explicit height stick.**
Without it, the grid's own default `stretch` behaviour would override
`height: 100vh` with the row's taller one regardless of what was
written — the same category of "the rule was there but something else
won" issue this series has found more than once, checked for
deliberately this time rather than discovered live again.

## The narrow screen, checked deliberately

Below 1100px the nav is a different thing entirely — a horizontal bar
at the top of the page, not a sidebar with a foot to pin, and `.who`
is already hidden there. Left unchanged, `position: sticky` plus
`height: 100vh` on a bar a few rows tall would have held a mostly-empty,
page-tall box open at the top of the screen. The narrow-screen media
query now explicitly resets both `position` and `height` back to their
ordinary values, checked as its own case rather than assumed to be
unaffected by a change made for the wide layout.

## What has coverage

jsdom applies no CSS, so no test here can assert a scroll position —
both tests read the real stylesheet text instead: one confirms the
wide-layout rule carries `position: sticky`, `top: 0`, `height: 100vh`
and the `align-self: start` the height depends on; the other confirms
the narrow-layout override resets both. Each was probed by deleting
the rule it checks and confirming only that test, not the other, fails.

vf-ui: 49 Worker, 335 browser. No migration.
