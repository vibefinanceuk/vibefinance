# 0572: `hidden` always hides, and the Attachments pane with it

**Status: built and tested locally, not yet pushed or deployed.** It
changes `vf-ui` only (`app.css`). There are no migrations.

## What was reported

0571 was deployed and tried live on 30 September. In the invoice window,
docked:

- with **Document** selected, the Attachments pane showed beneath the
  document;
- with **Timeline / Chat** selected, the Timeline showed beneath the
  Attachments pane, and ran over the Invoice Lines card.

Dan recognised it: "incorrect behaviour we have had before".

## Why

`.attachpane` (0571) sets `display: flex`. An author's class rule ties
with the browser's own `[hidden] { display: none }`, and wins. So when a
tab switch set `hidden` on the pane, nothing hid it.

This is the fourth time:

- 0271;
- the pop-out backdrop (`.backdrop[hidden]`);
- 0504's `.vtimeline`;
- now 0571.

Each time, one element got its own `[hidden]` rule, and the next new
element with a `display` of its own brought the bug back.

## What was decided

- **One rule for every element**, at the top of `app.css`:
  `[hidden] { display: none !important; }`.
  - Nothing in the stylesheets shows an element that is `hidden` on
    purpose; every existing `[hidden]` rule hides.
  - So the rule changes nothing that works today, and ends the pattern
    for elements not yet written.
- **`.attachpane[hidden] { display: none; }`** as well, beside the pane's
  own rule, as the other three have.

## Verification

- **Reproduced in Chromium** against the pop-out document window with
  test data. After opening Attachments and then choosing Document, the
  Attachments pane's computed `display`:

  | Stylesheet | `display` |
  |---|---|
  | 0571's | `flex` (the bug) |
  | this one | `none` |

- **`vf-ui`**: a new `viewer.test.ts` test reads the stylesheet for both
  rules, as the backdrop and timeline tests do, since jsdom applies no
  CSS. It fails against 0571's stylesheet. `viewer.test.ts`,
  `document-window.test.ts` and `typography.test.ts`: 347 of 348 pass,
  the one failure being the known `typography.test.ts` 10px gap.
