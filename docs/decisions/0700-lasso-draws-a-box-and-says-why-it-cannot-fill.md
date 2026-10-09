# 0700: The lasso draws a box, and says why when it cannot fill a field

**Status: live** at `dbbdc21`, pushed and deployed 9 October 2026, migration applied. vf-ui; vf-licence migration `0312_lasso_box_strings.sql`.

## What was asked

Dan, 9 October 2026, after trying 0697–0699 on a task he had not claimed:

> My mistake as I had not claimed the record, so the lasso was having no effect

> Would it be possible to change the freeform lasso to one that draws a rectangle
> when the mouse button is depressed. So for example, the user, clicks - and holds
> to extend a box around the desired text. I think this would be easier than a
> free form lasso. Also, implement 1 above as you suggest

"1 above" was: when nothing on screen may be changed, the lasso says why, and still
shows the words it read.

## What changed

**A box.** Pressing the mouse button sets one corner; dragging stretches a dashed
box to the pointer; letting go takes the words whose centres are inside it. The box
is passed on as its four corners, so everything after it is unchanged: the words by
their centres, the cut-out sent to the AI (0699), and rotation (a box turned by 90°
is still a box). The button keeps its name and gets a dashed-rectangle icon with a
pointer at its corner. The hint now reads *"Click a field, then drag a box round its
value on the page"*.

**Why it cannot fill.** `connectFields` takes a `readOnlyReason()` from the viewer:

- the stage allows editing but the task is not claimed by this person:
  *"Claim this task to fill fields from the document"*;
- the stage allows no editing at all: *"This stage does not allow changes"*.

Either way the toolbar adds the words it read (`· "Total 740,70"`), so the box still
works as a quick look-up. On a scan nothing is sent to the AI, since no field may
take its answer.

Clicking a field still shows where its value is, claimed or not.

## Checked

- `lasso.test.ts`: a box from a press and a release alone (no path between) takes
  the value and fills the field, and the dashed box is drawn while dragging and gone
  after; an unclaimed task says to claim it and shows what was read; on a scan, a
  read-only stage sends nothing to the AI. Every earlier lasso test now draws a box.
- In Chromium through the real viewer: a box dragged round `1.683,26 €` was drawn
  as a dashed rectangle and sent `1.683,26 €` with its label as context.
