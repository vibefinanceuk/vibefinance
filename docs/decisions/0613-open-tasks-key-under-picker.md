# 0613: Open tasks by user, the key under the drop-down

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-ui` only. Deploy vf-ui. No migrations.

## What was asked

Dan, 3 October 2026, with a screenshot of AP Analytics after 0612: on
Open tasks by user, *"the colour key spills beyond the boundaries of the
card"*, then *"Maybe move the key beneath the drop-down?"*

## Why it spilled

0612 put the drop-down, the 150px ring and its key side by side above a
560px window. A card three to a row is about 290px: the drop-down took a
third, the ring the rest, and the key was squeezed to nothing, so its
names and counts ran past the card's edge. The drop-down was cut short
too (*Alice McD*). The browser tests checked what the card held, never
where it fell at the width it is shown at.

## What was decided

- **The key goes under the drop-down**, in the left column; **the ring**
  is on the right, at 120px rather than 150px. It is still the ring's
  own key (`donutChart` builds it, its colours, counts and folded rest),
  moved, so the two cannot disagree.
- **Laid out by the card's own width**, a CSS container query on the
  card body, not the window's: a card's width depends on how many share
  its row. Where even this does not fit (under 250px), the ring goes
  under the key.
- On a wide card the left column stops at 300px, so the key stays near
  the ring it names.

## Verification

- **`vf-ui`** browser `workload-open-tasks.test.ts`: the key under the
  drop-down and not in the ring; and, new, laid out with the real
  stylesheets at **290px and 640px**, the key below the drop-down, the
  ring beside them, every part inside the card and no key row
  overflowing. 5 fail against 0612's card. Full run 1464, of which 1463
  pass (the known `typography.test.ts` 10px gap).
- While building this, a CSS edit of mine removed some 2,400 lines of
  `app.css`; the full browser run caught it (27 failures in five other
  files) and the file was restored from 0612's and the change made again
  on its own. The diff to `app.css` is the open-tasks block only.
