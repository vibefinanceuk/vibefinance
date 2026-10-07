# 0673: Purchase Orders — CSV Template and Load CSV, as an icon with its word

**Status: built and tested locally, not yet pushed or deployed.** It is
`vf-ui` only, with no migration. Deploy vf-ui.

## What was asked

Dan, 7 October 2026:

> On the Purchase Order screen, can you adjust the CSV Template, and
> Load CSV buttons so they are small and text appear to the right of
> the logo.

## What was built

The *Load purchase orders* card's head (vf-ui `purchase-orders.js`):

- **CSV Template** (`download`) and **Load CSV** (`load`, still the
  primary) are `compactLink`s (0662). They show a 16px icon with the
  word to the right, softer at rest and brighter on hover (0664), as
  Suppliers' (0665) and the coding lists' (0669) do.
- **Unchanged:** what they do. CSV Template is still disabled until the
  CSV format has loaded, and Load CSV is disabled while a load runs.
  The order pop-out's Hold, Release hold and Close keep their larger
  form.

## Verification

- **`vf-ui`** browser `purchase-orders.test.ts` gains 1 test: the
  card's head holds CSV Template then Load CSV, both compact, each
  beginning with its icon. The existing load and template tests pass
  unchanged: 60 of 60.
- **Screenshots** of the card in Day and Night.
- **Full run**: vf-ui browser 1625, of which 1624 pass (the known
  `typography.test.ts` 10px gap).
