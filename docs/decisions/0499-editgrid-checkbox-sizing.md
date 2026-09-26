# 0499 — Return Reasons' own "Active" checkbox, stretched by `.editgrid`'s own width rule

**Status: built and verified locally, not yet committed/pushed at the
time of writing.**

## What was asked

Not a new feature — a visual bug reported live from two screenshots of
the new AP Setup "Return Reasons" tab: "The check box on return reasons
seems kinda large."

## What was found

`.editgrid > input { width: 100%; }` — the rule that makes every text
input and number input in this shared grid stretch to fill its own
column — has no exclusion for `[type="checkbox"]`, so the Return
Reasons "Active" checkbox (decision 0498) stretched to the full width
of its grid column too: a native checkbox rendered as a large square
block, wrapped onto its own row beneath the reason's label input,
exactly matching the screenshots.

**This is the same bug decision 0282 already found and fixed once, in
a different grid** — `.columnlist`'s own checkboxes, at the time. That
fix excluded checkboxes from `.columnlist`'s width rule and gave them
a deliberate, explicit size instead of "whatever the browser renders."
`.editgrid`'s own width rule was never given the same treatment,
because nothing that used `.editgrid` had put a bare checkbox directly
inside it until now — `coding-lists.js`'s own "default" checkbox and
`ap-setup.js`'s pre-existing number-limit checkbox (Account Coding
tab) sit in `.editgrid` too and carry the identical latent bug, simply
never reported because nobody happened to be looking at either at the
right moment.

## What was decided

Fix `.editgrid` itself, not just the one checkbox that got reported —
the same "fix the shared class, not the one instance" discipline
decision 0497 already used for `.popout .kf`'s own spacing and
textarea sizing, since duplicating a scoped fix per screen is exactly
how this class of gap recurs. `.editgrid > input:not([type="checkbox"])
{ width: 100%; }` plus an explicit 14px size for the checkbox itself,
matching decision 0282's own values exactly rather than inventing a
second, slightly different "deliberate size."

## What was built

- **`workers/vf-ui/public/app.css`**: `.editgrid > input { width:
  100%; }` narrowed to `:not([type="checkbox"])`; a new
  `.editgrid > input[type="checkbox"]` rule (14×14px, matching
  `.columnlist`'s own from decision 0282).

## What was not built

No change to `ap-setup.js`, `coding-lists.js`, or any other caller —
this was purely the shared CSS rule, and every existing `.editgrid`
checkbox (Return Reasons' own new one, and the two pre-existing ones
named above) is fixed by the same change with no per-screen edit.

## Verification

- `workers/vf-ui`: `test-browser/ap-setup.test.ts`,
  `test-browser/coding-lists.test.ts`, `test-browser/access.test.ts`,
  `test-browser/sources.test.ts` — all pass unchanged (none asserts on
  checkbox dimensions, only `.value`/`.checked`, so nothing to update).
  Full browser suite unchanged at 1165/1166 — the one failure remains
  the pre-existing, unrelated `typography.test.ts` gap (decision 0498's
  own verification already confirmed this predates that work; this
  change touches no `font-size` rule, so it does not affect that test
  either way). Plain suite **75/75**, unchanged.

## Still to do, operator side

Push, then redeploy **`vf-ui` only** (CSS-only change, no `vf-app` or
`vf-licence` involvement, no migration) and reload the Return Reasons
tab — the "Active" checkbox should now render at a normal, inline size
next to its Save link.
