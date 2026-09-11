# 0253 — Counting what the click can show

**Status: fixed.** Reverses part of decision 0252, written the same day.

---

## The record and the change disagreed

**Decision 0252 exists to make a card's count agree with the list it
links to.** The same change added idle instances — process instances at
a stage with no open task — to that count, on the argument that *a stage
between tasks is still a stage with work in it.*

**True about the work, and false about the card.**

A task list cannot show an instance that has no task. So the card would
have said **ten** and the list **nine**, by construction — which is
exactly what decision 0252 was written to prevent.

**And I did not notice**, because the live data had no idle instances at
the stages being looked at. It would have appeared the first time a
stage sat between tasks.

---

## So *unclaimed* means an open task nobody has taken

Which is a team queue — **still the one that grows quietly**, and still
worth its segment.

**An instance idling with nothing raised is a real thing and wants a
card of its own.** It is not this one.

---

## The assertion decision 0252 needed

The new test compares the card against **what the list would return, in
the list's own terms** — two queries, one answer.

Watched to fail by adding one to the count: **nine tests break**,
because agreeing with the list is not one property of this card but the
whole of what it claims.

---

## How this was found

**Not by a test, and not by the screen.** The operator reported counts
that looked wrong; three hypotheses of mine were wrong; and the query
that settled it — `card says 9, of those mine 9, idle instances 1` —
made the flaw visible in a number I had introduced an hour earlier and
not yet deployed.

**Two of the three wrong hypotheses were real bugs anyway** (decision
0252's multiplication and stage divergence), which is luck rather than
method.
