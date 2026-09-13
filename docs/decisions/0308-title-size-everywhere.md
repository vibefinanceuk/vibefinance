# 0308 — Inverting the title size, and a near-miss with the viewer's own rule

**Status: built.**

---

## What was asked

> The font increase on the Dashboard heading is good. Please can you
> replicate the font increase on other pages? Tasks, Sources,
> Suppliers, Rules, Documents

Five screens, named specifically. The viewer and "Write a rule" were
not — treated as a deliberate signal rather than an oversight, since
both are sub-screens reached by drilling into one of the five rather
than top-level destinations themselves.

## What was built

Decision 0307 scoped `--text-xl` to `.dashboardpage` alone. With five
more screens asking for the identical value, the scoped override was
the norm and `.topbar h2`'s own base rule — `--text-lg`, shared by
every screen — was the exception. Inverted rather than repeated:
`.topbar h2` itself now carries `--text-xl`, and Tasks, Sources,
Suppliers, Rules, and Documents all pick it up automatically, since
all five already render into the same `#shell` the base rule already
reaches.

**"Write a rule" needed a real, new scoped rule**, since it was not
named and shares `#shell` with every other screen — `.composepage`,
a new wrapper class on `compose.js`'s own outer container, holding it
at `--text-lg`.

## A real near-miss, caught by an existing test rather than shipped

The viewer was assumed to need the same kind of scoped-back-down rule
— and very nearly got one, `#viewer .topbar h2, .composepage .topbar
h2 { font-size: var(--text-lg); }`, alongside compose's own. It did
not need one at all: decision 0182 already gives `#viewer .topbar h2`
its own rule, matching the viewer's own heading to the same small,
muted styling as its other three summary lines — and an id-scoped
selector already wins over `.topbar h2`'s own class selector by
specificity, regardless of which value either one carries. Adding a
second rule for the same selector would not have protected anything;
it would have shadowed decision 0182's own `--text-sm` by landing
later in the file, since an equal-specificity tie resolves by source
order — silently turning the viewer's own four-line list back into a
heading and three notes, the exact thing decision 0182 argued against
building.

**Caught by `typography.test.ts`'s own two, pre-existing tests for
that rule** — both failed the moment the duplicate landed, not because
either was wrong, but because they'd been written against the old
`--text-lg` base value and the duplicate rule made the wrong thing
fail for the wrong reason at first glance. Investigated properly
rather than loosened: removed the unnecessary `#viewer` rule entirely,
then updated both tests' own expected value to the new, correct
`--text-xl` base — their real claim, that an id beats a class
regardless of the general rule's own value, was never in question and
needed no change.

## What has coverage

The rewritten stylesheet test confirms the base `.topbar h2` rule now
carries `--text-xl` and that `.composepage`'s own override still holds
it at `--text-lg`, probed directly by reverting each independently. A
new test in `compose.test.ts` confirms `.composepage` is genuinely
present in the rendered markup, not just claimed in a comment — probed
by removing the class and confirming the test catches it. Both of
`typography.test.ts`'s own pre-existing tests updated to the new base
value and re-verified passing, their own underlying claim unchanged.

vf-ui: 49 Worker, 395 browser (was 394). No migration.
