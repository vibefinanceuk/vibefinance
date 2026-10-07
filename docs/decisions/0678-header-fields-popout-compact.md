# 0678: The Header Fields pop-out as a compact list

**Status: built and tested locally, not yet pushed or deployed.** It is
`vf-ui` only, with no migration. Deploy vf-ui.

## What was asked

Dan, 7 October 2026, with a screenshot of *All invoice header fields*:

> There is a lot of space wasted as each field has a horizontal
> separator. Also the field contain a back colour which I do not think
> is needed. Could we remove the horizontal line and the back colour on
> the text and perhaps reduce space between rows?

## What was built

The pop-out's rows (vf-ui `app.css`, `.hffields`):

- **No line between rows.** Each row lost its top border.
- **Rows sit close.** Each row has 5px above and below, and the 16px
  `.popout .kf + .kf` margin that stacked on top of it is gone here.
- **A read-only value is plain text.** It is on the right, with no
  shaded box, padding or minimum height, in the primary text colour.
- **Taller: it fits the window.** Dan, while this was being built:
  *"Expand the height to fit all fields on the screen of the pop-out."*
  The pop-out (`.popout.hfpopout`) may now be as tall as the window less
  32px, instead of the 80% every pop-out has. With the closer rows,
  every field shows at once; it scrolls only if there are more than the
  window holds.
- **Unchanged:**
  - a field the person may edit in the pop-out (0292) keeps its input
    box, so it still reads as editable;
  - amounts still show as money (0677);
  - the header card and every other pop-out are unchanged.

## Verification

- **`vf-ui`** browser `viewer.test.ts` gains 1 test: the stylesheet
  gives `.hffields` rows no border and 5px padding, no stacked margin,
  a read-only value no background or padding, and the pop-out the
  window's height. 303 of 303 pass.
- **Screenshots** of the pop-out in Day and Night.
- **Full run**: vf-ui browser 1645, of which 1644 pass (the known
  `typography.test.ts` 10px gap).
