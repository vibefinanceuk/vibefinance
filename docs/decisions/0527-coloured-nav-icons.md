# 0527 — Side menu icons take their own colour on hover and selection

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
changes `vf-ui` only (`tasks.js`, `app.css`, `tokens.css`), with no
migration and no string change.

## What was asked

> I'd like to jazz up the ui a little. I wondered if you could mock-up
> and experiment with colourising the slide menu icons. When hovered
> over, or selected the colourised icons would be displayed. Else they
> would appear as they do now.

A mock-up showed four options beside today's menu, with a palette
toggle: A (one accent), B (by section), C (per icon) and D (per icon,
on a tinted tile, with a bar on the selected item). The operator chose:

> D please

The palette was not named. The mock-up's screenshot, and its
recommendation, used the **Vivid** set, because the app's chart
palette is deliberately quiet (0258) and read almost as grey on the pale
Day menu. Vivid was built; switching to the chart palette is a
five-line token change.

## What was decided

- **Five new tokens, `--nav-1` to `--nav-5`,** in `tokens.css`, with
  Night values in both Night blocks (the media query and the chosen
  `data-mood="night"`), as the chart palette does. They are used only
  by the side menu.

  | | Day | Night |
  |---|---|---|
  | 1 | `#2563eb` blue | `#60a5fa` |
  | 2 | `#0d9488` teal | `#2dd4bf` |
  | 3 | `#7c3aed` violet | `#a78bfa` |
  | 4 | `#ea580c` orange | `#fb923c` |
  | 5 | `#db2777` pink | `#f472b6` |

- **A fixed colour per screen.** `frame()` numbers each screen by its
  place in the full menu, cycling 1–5, and `navLink` adds
  `navhue<N>`. Because the numbering ignores permissions, a screen is
  the same colour for everyone.
- **The icon sits in a `.navicon` tile.** At rest the tile has no
  colour or background, so the menu looks as it did. On hover, or on
  the open screen, the icon takes its colour on a 16% tint of the same
  colour, and the open screen gets a 3px bar in that colour on its left
  edge.
- **Nothing moves.** The tile is 32px with a -4px margin, so rows keep
  their height and labels their position. The icon itself is now 22px
  inside the tile, from 24px.
- Works folded (0311, 0525) and in both moods.

## What was verified

- **`tasks.test.ts` (browser):**
  - Dashboard, Documents, Suppliers, Access and Rules get hues 1, 4,
    5, 1 and 5. Without `AP.Supplier`, Rules keeps hue 5.
  - Every nav icon sits inside `.navicon`.
  - From the real stylesheet: colour and tint apply only on hover or
    `.on`; the tile has no colour or background at rest; the bar uses
    the hue; each `navhueN` maps to `--nav-N`; each `--nav-N` is
    defined three times in `tokens.css`.
  - Both new tests **failed** with `public/` stashed.
- **Playwright screenshots** of the real `frame()` and stylesheet, with
  one item selected and one hovered, expanded and folded, Day and
  Night.

## Verification

- **`vf-ui`**: Worker 75/75. Browser 1215/1216. The one failure is the
  known `typography.test.ts` hardcoded-`10px` gap.
- **`npx eslint`** on `tasks.js` and `tasks.test.ts`: clean.
