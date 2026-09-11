# 0228 — A card's own action

**Status: built.** *Change Seller* and *Change Buyer*, beside each
card's title.

---

## The same shape as the document's controls

> In a similar way we have done with the actions under the Document
> image, that read Expand, Complete, Release and Return — create a new
> icon and button for the Seller and Buyer cards.

**`actionLink` already existed** and took a name: icon above label, a
`title` attribute because *"an icon alone is a guess"*, and disabled
where there is nothing to do.

So this is two strings and an icon, not a control.

---

## Bottom right was wrong, and the operator said why

> It might extend the card size if we place at the bottom right. There
> is space in the top right already, due to the card heading creating
> some empty space.

**Which is the whole argument.** A footer adds height to a card in a
column already short of it, and the heading row has room doing nothing.

**It also removed a separator** I had put above the footer to make it
read as a footer — a horizontal rule inside a small card, which was the
thing I had flagged as possibly too heavy and would have kept.

The button is pulled up a few pixels so its own padding does not push
the title's baseline down: **the row should be the height of the title,
not of the button.**

---

## Two arrows circling, not a pencil

**A pencil says *edit this value***, and neither of these does. They
**replace one record with another** — the invoice stops pointing at Acme
UK and starts pointing at Acme Deutschland, and nothing about either
record changes.

**The same glyph on both cards**, deliberately. They are the same act on
either side of the document, and two icons would say they were not.

---

## Offered even when a match was found

**A wrong answer is worse than none.**

None stops at the org gate (decision 0037). **A wrong one sails through
every org-scoped stage after it** — decision 0196's rules, decision
0197's fields, decision 0199's permissions, decision 0202's queues —
each behaving correctly on the wrong answer.

So the action is on the card in both states, and a test asserts it for
both.

---

## What is not built

- **Nothing re-runs the rules** after a buyer or seller is changed. An
  invoice routed somewhere for having neither stays routed there —
  decision 0222's gap, now reachable from two cards instead of one.
- **The label says *Change* on a card that has nothing yet.** *Choose*
  would be more accurate in that state, and two labels for one button is
  a thing to learn. Left as asked.
