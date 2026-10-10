# 0712: Open tasks by user: the person picker sits in the card's heading

**Status: live** at `a88700f`, pushed and deployed 10 October 2026. vf-ui only (`workload-open-tasks.js`, `app.css`).

## What was asked

Dan, 10 October 2026, on AP Analytics, Operational Performance:

> could we relocate the user drop down in Open Tasks By User, to be in the top right, in
> the same way that the Average Handling Time and Claim To Complete Cycle is.

## What changed

The person drop-down moves from above the key into the card's heading, at the right, with
the same class (`windowpick`) and size as the period pickers on Average handling time and
Claim-to-complete cycle time. Its "User" label goes; the drop-down keeps it as its
accessible name. The key now heads the left column, the ring stays on the right (0613), and
the name search for more than eight people (0617) stays in the left column above the key.

## Tests

vf-ui `workload-open-tasks.test.ts`: the heading holds the title and the picker; the left
column holds the key; at 290px and 640px the picker sits at the heading's right, above the
key, inside the card.
