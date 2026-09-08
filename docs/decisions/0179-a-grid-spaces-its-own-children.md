# 0179 — A grid spaces its own children

**Status: fixed.** The Seller and Buyer boxes line up again.

---

## Two boxes side by side that did not match

> Why is the border under seller different from the border under buyer?

`.parties` is a grid, so both panels **stretch to the same row height**.
Decision 0178 then gave every panel `margin-bottom: 14px` — right for a
stack of cards — with a `:last-child` reset so nothing dangles at the
bottom of a column.

**In a grid, `:last-child` is one of the two boxes.** The Buyer kept its
full height and the Seller lost 14px to a margin inside an equally-tall
box, so their borders stopped lining up.

**An hour after the margin was added**, and only visible because
somebody looked at the two together.

---

## The rule was right and its scope was not

A grid already spaces its children — `.parties` has a `gap: 16px`. A
margin inside a grid item is a margin **inside the box**, not between
boxes, which is a different thing that happens to look similar when
there is only one row.

So panels inside `.parties` carry no margin, and the stack rule stands
everywhere else.

---

## And dead styles for a card that no longer exists

`.statusrow`, `.statusbar` and `.statitem` styled the panel decision
0175 removed, and outlived it.

**Dead CSS reads as a thing that exists**, and the next person adding a
status bar would find rules that look considered and describe nothing.
Removed, and the tests refuse them.

---

## What is not built

- **Nothing checks a rendered layout**, still. `jsdom` has no layout, so
  these assert rules rather than that two borders align — which is why
  a screenshot found it and the third such finding in a day.
