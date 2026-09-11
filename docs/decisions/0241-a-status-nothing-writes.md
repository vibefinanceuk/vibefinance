# 0241 — A status nothing writes

**Status: fixed.** Two cards counted instances by a value this system
has never written.

---

## Reported by reading the JSON

Three tasks were open and `where_things_are` returned an empty list.

Both stage cards filtered on `process_instances.status = 'active'`.
**Migration 0009's own default is `'in_progress'`**, and the only other
value the engine writes is `'completed'`.

**I assumed the word rather than reading the column.**

---

## The shape that makes this survive

**A count of zero is indistinguishable from a quiet queue.**

Nothing failed, nothing logged, and the card looked like good news. A
list that returns nothing invites a second look; **a number that returns
nothing is an answer.**

Which is why it took a person reading raw JSON to notice — and why it
would have been worse on a screen, where an empty bar chart reads as *no
backlog*.

---

## And the tests agreed with it

The seed inserted `'active'` too, so **eleven tests passed against a
fixture that shared the mistake.**

**A fixture that shares a mistake with the code proves the mistake.**
This is the third time this month a check has been weaker than
production — decision 0223's CSS variables and decision 0235's empty
replay database being the others, and all three the same shape: **the
check and the thing checked came from the same wrong idea.**

---

## What was added

**The value is named once**, so the next card cannot get it wrong
differently.

**And a test that two cards counting the same work must agree.** That is
the assertion the first version did not make, and the one that does not
depend on knowing which status string is right: `waiting_for_me` and
`where_things_are` count the same queue from different tables, and a
disagreement is a fault whichever of them is wrong.
