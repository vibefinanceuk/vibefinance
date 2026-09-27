# 0528 — The "Here because" card is amber, in Day's colours in both moods

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
changes `vf-ui` only (`viewer.js`, `app.css`), with no migration and no
string change.

## What was asked

> When I drill down into the document image, and at the top it says
> 'here because', please can that card be highlighted in amber, with a
> solid amber sleeve to the left. I would like this field to stand
> out. please can you mock up?

A mock-up showed today's card, A (amber tint and a solid sleeve) and B
(as A, plus a warning icon, the label in amber, and a thicker sleeve).
The operator then asked:

> I really like the colour palette on the day card. I prefer that to
> the colour palette on the night card. please can you use the amber
> and palette used on the day card for both?

and chose:

> B please

## What this reverses

Decision 0478 kept this card neutral on purpose: it names an ordinary
rule outcome, and amber is this app's "look at this" tier (0395). The
operator wants it to stand out, and that is their call. It still does
not use `.needsattention`, which means something broke, and 0478's test
for that still passes.

## What was decided

- **`reasonLinePanel()` (`viewer.js`)** puts the existing
  `systemalert` icon, `aria-hidden`, before "Here because:".
- **`.panel.reasonline` (`app.css`):**
  - an amber background (`--bg-warning`), a faint amber border, and a
    solid 6px `--border-warning` sleeve on the left, square-cornered on
    that side;
  - the label in `--text-warning`, semibold; the icon in the same
    colour, 18px;
  - the details box a translucent white over the amber.
- **Day's colours in both moods.** The card re-declares, on itself, the
  Day values of every token it uses (`--bg-warning`, `--text-warning`,
  `--text-primary`, `--text-secondary`, `--text-accent`,
  `--surface-2`). On a Night page it stays a pale amber card with dark
  text. `--border-warning` is already the same in both moods.
- **The refusal flash (0487) still shows.** It used to pulse from
  transparent to `--bg-warning`. On an amber card that would barely
  show, and passing through transparent would blank it. It now pulses
  from the card's own amber to a deeper mix of the sleeve colour.

## What was verified

- **`viewer.test.ts`:**
  - The icon is first in the row, `aria-hidden`, then "Here because:".
  - From the real stylesheet: the amber background, the 6px sleeve, the
    re-declared Day values, the amber label, and a flash with no
    `transparent` in it.
  - Both new tests **failed** with `public/` stashed.
- **A Playwright screenshot** of the real stylesheet on a Day and a
  Night page: the same pale amber card on both.

## Verification

- **`vf-ui`**: Worker 75/75. Browser 1217/1218. The one failure is the
  known `typography.test.ts` hardcoded-`10px` gap.
- **`npx eslint`** on `viewer.js`: clean.
