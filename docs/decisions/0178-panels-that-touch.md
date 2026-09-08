# 0178 — Panels that touch

**Status: fixed.** A panel has room beneath it.

---

## Reported twice, as two different screens

> Please can you insert a break between the process flow and the seller
> and buyer boxes.

> Please also add the same break between the invoice header and invoice
> line boxes.

**One fault, and it looks like a different one each time** — which is
why it took two reports to see.

`.panel` had **no bottom margin at all**. The two-column grid has a
`gap`, which spaced the columns; nothing spaced panels *within* a
column, so every stack of cards ran together.

Decision 0177 was a real and separate bug found in the first report —
`.columns` meaning two things, so the layout was not a grid at all. It
hid this one, and fixing it revealed it.

---

## On the panel, not on the screens

Every panel in this interface is a card in a stack. **A rule per screen
is a rule the next screen forgets**, and there are five screens now.

`:last-child` clears it, so nothing dangles below the final card in a
column.

---

## What is not built

- **Nothing checks a rendered layout.** `jsdom` has no layout (decision
  0121), so this asserts the rule exists rather than that two panels are
  apart — the same limit decision 0156 recorded about a textarea's
  width, and the same reason a screenshot found it.
