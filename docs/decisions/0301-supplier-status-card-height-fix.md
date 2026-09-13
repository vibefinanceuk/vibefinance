# 0301 — Height match, taken further: explicit rather than implied

**Status: built.**

---

## What was asked

> alignment between cards at the bottom still seems off

Reported against a screenshot of the real, deployed result of decision
0300 — the two panels' own borders visibly ended at different heights,
the status card's own taller than the load-file card's.

## Why decision 0300's own fix wasn't enough

Removing `align-items: start` from `.supplierhead` left grid's own
default, `stretch`, to match both panels to the row's own height — the
standard, unremarkable way this is normally done, and the fix decision
0300 reasoned would be sufficient. The screenshot says otherwise: the
two panels still ended at different heights on the actual, deployed
screen.

**Made explicit rather than diagnosed further.** Rather than continue
reasoning about why the implicit default wasn't visibly taking hold,
`.supplierhead > .panel { height: 100%; box-sizing: border-box; }`
says directly, on the element itself, what `align-items: stretch` was
only ever implying by omission — a more forceful instruction in place
of one that evidently wasn't enough on its own. The narrow-screen
media query, where the grid drops to a single column and there is no
longer a row to match, sets `height: auto` back on the same selector
so the override does not linger somewhere it no longer means anything.

## What has coverage

The existing stylesheet-text test from decision 0300 already checked
the width change; extended rather than replaced, it now also asserts
the real `.supplierhead > .panel { height: 100%; }` rule exists — the
`align-items: start` absence check dropped, since that was never the
thing actually holding the height match in place. Probed directly:
removing the new `height: 100%` declaration fails exactly this test.

vf-ui: 49 Worker, 378 browser (unchanged count — an existing test
extended, not a new one added). No migration.
