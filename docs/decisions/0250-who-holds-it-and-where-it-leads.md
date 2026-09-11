# 0250 — Who holds it, and where it leads

**Status: built.** The dashboard's second round, from six observations.

---

## The sort buttons highlighted and nothing moved

`sortBy` set a local object and re-fetched — and the fetch returned a
dashboard sorted by **what the server had stored.**

**Sorted where the data is** was right: the list is capped at 25 rows
(decision 0240), and reordering in the browser would rearrange a sample
and call it an order.

**Which means the server has to be told, and telling it is saving it.**
So the choice sticks between visits, which is what somebody who always
sorts by due date would want anyway.

---

## Who holds the work, not just how much

A count says *how much*. The ring says **whether it is anybody's**:

- **Mine** — assigned to me or claimed by me (decision 0180)
- **Taken** — somebody has it, and I need nothing from it
- **Unclaimed** — **the one that grows quietly**, because nobody is
  holding it and nobody is neglecting it either

**An instance with no task at all counts as unclaimed**, because from
the reader's side it is the same thing.

**No legend on this ring.** The card has three segments, a heading that
names none of them, and no room — the card's own text carries the
meaning and a legend would repeat it.

---

## The filters existed and nothing could set them

*"Eleven at Approval, three of them mine"* invites *"show me those
three"* — which **the task list could already answer** and had no way of
being asked. `filters` was a module-level object nothing outside
`tasks.js` could reach.

**And a card that leads nowhere should not look like a link**, so the
click only appears where any are mine — decision 0161's argument about
an action with nothing to do.

**The same for a worklist row**, which named an invoice and could not
open it. **A row that reads like a link and does nothing is worse than
one that does not**, because somebody clicks it twice before believing.

---

## And the worklist scrolls

Twenty-five rows is a card taller than the screen, and **everything
beneath it becomes unreachable without scrolling past somebody else's
work.**

A fixed height makes the page's shape stable whatever is in the queue.
**The heading sticks and is opaque**, or the rows scroll under it.

---

## What is not built

- **Nothing tells the task list it was filtered.** It opens showing
  three of eleven and looks like a task list with three tasks in it.
- **The stage ring has no hover**, so the three segments are three
  colours and the reader infers the order from the heading.
- **`openTaskById` builds a task-shaped object from a worklist row**
  rather than fetching the real one. It carries what the viewer needs
  and is not the same thing — if the viewer ever wants a field the
  worklist does not return, this is where it breaks.
