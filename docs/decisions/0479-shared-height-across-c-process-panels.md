# 0479 — `.c-process` shares its stretched height, instead of every panel claiming it whole

**Status: built, tested, documented. Not yet pushed or deployed** —
this session still has no push access to `vibefinanceuk/vibefinance`;
delivered as a git bundle for the operator's own pull/push/deploy
sequence, the same path every decision this session has used.

---

## What was asked

Reported live, cautiously, after decision 0478 had already been
confirmed pushed, deployed, and working: *"I've noticed a page
orientation issue. which might be new, but not sure."* Two screenshots
and a precise description followed once asked to clarify — the
popped-out document view (decisions 0388/0390/0392/0393):

1. The "Here because" and "Document open in a separate window" cards
   at the top were too tall, and the "Here because" text sat aligned
   differently from the card beside it.
2. The process timeline seemed to overlay the Seller and Buyer cards.
3. The Invoice Header card was not as tall as the Seller and Buyer
   cards.

## What was found

All three are one root cause, and it is decision 0478's own doing —
not user error, and not something to wave off as pre-existing.

`#viewer .columns.docpoppedout .c-process` is stretched to the row's
real height by `#viewer .columns`'s own `align-items: stretch` (the
same mechanism decision 0393's comment already documents for
`.c-parties`). The rule this decision replaces —
`#viewer .columns.docpoppedout .c-process > .panel { height: 100%; }`
— was written when `.c-process` could only ever hold one panel:
`progressRow()` alone, or `workflowErrorPanel()` in place of it during
a genuine stage error (decision 0435). `height: 100%` on that one
panel simply meant "fill the row," which was correct.

Decision 0478 added a second, now commonly-present panel —
`reasonLinePanel()` — that renders *alongside* `progressRow()`,
composed in `viewer.js` as `[workflowErrorPanel(), reasonLinePanel(),
progressRow()].filter(Boolean)`. `.c-process` can now hold up to three
panels at once, and the old rule gave *every one of them* `height:
100%` — each independently claiming the row's full height rather than
sharing it. Stacked, their combined rendered height could run to
200–300% of the row's actual height, and that overflow is exactly
what read as the process timeline "overlaying" the Seller/Buyer row
beneath it: it wasn't overlaying anything, the row it belonged to had
simply grown far taller than the grid intended.

`workflowErrorPanel()` alone could theoretically have triggered a
milder version of this already (a stage error while a task is also
open would render two panels), but that combination is rare.
`openTaskReason` is present on most open tasks — normal, everyday
coding work, not only failures — which is what turned a latent
two-panel edge case into something visible on an ordinary invoice.

Symptom 3 — Header not matching Seller/Buyer height — is a related but
independently-preexisting gap, not caused by decision 0478. Decision
0393 added `#viewer .columns.docpoppedout .c-parties > .parties {
height: 100%; }` to cover the one direction that had been observed at
the time: Header taller than Parties. Nothing covered the reverse.
Symptom 3 is visible in the reported screenshot only because the
Seller card in that screenshot is long enough to be the taller side —
it carries an unmatched-supplier notice (decision 0473/0474 territory)
plus several editable fields, all of which push `.c-parties` past
`.c-header`'s own natural height for the first time in this session's
history.

Confirmed by direct code reading against `app.css`'s existing
`docpoppedout` grid rules (decisions 0388/0390/0392/0393), then
verified visually — not just argued about — with a standalone
Playwright screenshot harness built for this purpose (not part of the
repo, scratch-only), reproducing the real `#viewer .columns
.docpoppedout` DOM structure with content matching the reported
screenshots. A before/after comparison using `app.css` from the
already-pushed commit (`c48882f`) versus the locally fixed version
confirmed both: the bug reproduces exactly as described on the old
CSS, and is gone on the new CSS, across the one-panel, two-panel
(error + progress), and three-panel (error + reason + progress) cases.

## What was built

`#viewer .columns.docpoppedout .c-process` becomes a `display: flex;
flex-direction: column` container. Its panel children get `flex: 0 0
auto` — each keeps its own natural, content-based height rather than
stretching. Only `.c-process > .panel:last-child` — `progressRow()`,
whenever it renders, which is always the last item in the composed
array — gets `flex: 1 1 auto; min-height: 0` and grows to fill
whatever room is left after the banners above it. With exactly one
panel (the only case the old rule ever actually ran under), `flex: 1`
on it reproduces the old `height: 100%` behavior exactly — this is not
a behavior change for the common single-panel case, only a fix for
the multi-panel one.

`#viewer .columns.docpoppedout .c-header > .panel` gets the symmetric
`height: 100%; box-sizing: border-box` decision 0393 gave `.c-parties`
in the one direction it needed at the time. Same reasoning, same
mechanism (`height: 100%` resolves as `auto` during row sizing, and
only takes its real value once the grid's own `align-items: stretch`
has settled the row height), now covering both directions.

Both comments in `app.css` explain the reasoning at the point of the
rule, in line with this codebase's own convention, rather than leaving
the next reader to reconstruct it.

## What was not built

No change to `viewer.js`'s panel composition, and no change to
`reasonLinePanel()` or `workflowErrorPanel()` themselves — the fix is
entirely in how `.c-process` distributes height across whatever panels
it is handed, which is the right layer for this: it makes the CSS
correct for any future panel that gets added to that same composition,
not just the two that exist today.

## Tests

`workers/vf-ui/test-browser/viewer.test.ts` — 2 new tests, alongside
the existing `docpoppedout` class-toggle test: asserts the actual
`app.css` rule text (via the existing `virtual:stylesheets` import
pattern this codebase already uses for CSS-rule assertions, e.g.
decision 0437's nav tests) rather than computed layout, since jsdom
computes no real grid or flexbox. One test confirms `.c-process` is a
flex column with banner panels at `flex: 0 0 auto` and the last panel
at `flex: 1 1 auto; min-height: 0`; the other confirms `.c-header >
.panel` carries the new symmetric `height: 100%`.

**Suite state:** `vf-app` unchanged. `vf-ui` browser 1091 → **1093**
(+2, this decision's own new tests); 1092/1093 passing — the one
failure is the pre-existing, unrelated `typography.test.ts` hardcoded
`font-size: 10px` gap already documented in decision 0478, confirmed
identical on unmodified `main` via `git stash` again this decision.
`vf-ui` Worker unchanged at 74/74. `eslint public test-browser` has
one pre-existing, unrelated error (`ap-setup.test.ts:588`, unused
`puts`), also confirmed identical on unmodified `main` via `git
stash`; not touched here, out of scope of this decision.

## Verification

Visual, not just arithmetic: a standalone Playwright screenshot
harness (scratch-only, not part of the repo) rendered the real
`docpoppedout` DOM/CSS structure at 1920×1300 for the one-panel,
two-panel, and three-panel cases, using `app.css` from the
already-pushed `c48882f` (reproduces the bug exactly as screenshotted
by the operator) and from the locally fixed version (compact banner
cards, no overlap, Seller/Buyer/Header all matching height, in every
panel-count case).

## Still to do, operator side

Same as every prior decision this session: pull the bundle, push,
apply migrations if any (none in this decision — CSS and tests only,
no schema change), deploy, and confirm live. Once confirmed, the usual
follow-up documentation-only commit updates `docs/HANDOVER.md`'s
confirmation record and is delivered as its own small bundle.
