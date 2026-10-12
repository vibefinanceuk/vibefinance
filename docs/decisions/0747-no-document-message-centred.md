# 0747: "No document is retained" sits in the middle of the document panel

**Status: built.** vf-ui (`app.css`), vf-portal (`app.css`, kept identical).

## What was asked

Dan, 12 October 2026: *"When the new invoice page is launched - the document window reads
"No document is retained for this invoice.". Please can you center the text alignment, rather
than it being aligned left?"*

## What changed

- The page viewer mounts the message straight into `.vpagesroot`, a flex row. It shrank to
  the width of its words and sat on the left. Now `.vpagesroot > .vthumb { flex: 1; }` makes it
  fill the row, so `.vthumb`'s own centring puts it in the middle.
- `.vthumb` centres its text and has a little padding, so a message that wraps in a narrow
  panel stays centred line by line.

## Tests

vf-ui `page-renderer.test.ts`: the message is the viewer root's only child, and the stylesheet
grows and centres it. The existing page-renderer tests are unchanged and pass. The typography
test's existing `font-size: 10px` failure is unrelated.

## To deploy

Deploy vf-ui (and vf-portal, whose stylesheet is the same file).
