# 0240 — What a person should do next

**Status: built, and not yet on a screen.** The queries and the schema;
the interface is the next piece.

---

## Nine cards, one filter

Decision 0239 found that **every count is a disclosure**. *"47 items in
Approval"* tells somebody there are 47 invoices they may not be allowed
to see, and decision 0202 made the task list unit-aware precisely so
that a German validator is not shown French work.

**So the scope is computed once and threaded into every query**, rather
than each card remembering. That record called it the part most likely
to be got wrong, *"because a count feels like less than a list."*

**Three tests exist for that alone**, and one of them — *counts nothing
for somebody permitted nowhere* — is the one that fails if **empty** is
ever conflated with **unrestricted**.

### And my first attempt to break it did not

Disabling the empty-list branch changed nothing, because an empty list
produces `IN ()` which SQLite already treats as false.

**The branch is belt to a brace, and stated anyway**: a reader should
not have to know that, and a later change to how the clause is built
could lose it silently.

**The probe was wrong, not the test.** Conflating empty with `null` —
the real mistake — fails immediately.

---

## The default lives in code

A person with no dashboard gets one and **nothing is written**.

Seeding a row per user in the migration would **freeze today's idea of a
good dashboard into every account** before anybody had seen it, and a
default belongs where it can change with the card types.

---

## One card failing is not the dashboard failing

A stage removed mid-flight, a fact that will not parse — **the dashboard
is the one screen where a single bad row could take away everything a
person came for.**

Each card is run in its own `try`, and a broken one is empty beside
eight standing.

**A stage that no longer exists says so** rather than showing a zero,
which would look like good news.

---

## Buckets, not averages

*How long have things waited* is five buckets rather than a mean.

**An average of three days hides one item from August**, and the one
from August is the story — which is decision 0239's argument for showing
age at all.

---

## What is not built

- **No screen.** The route returns nine cards of data and nothing
  renders them. **That is the next piece and the larger half.**
- **No library.** The card types are a closed set and a person cannot
  yet add, remove or reorder — `dashboard_cards` takes rows and only a
  test writes any.
- **No chart palette.** `tokens.css` has accent, success and warning and
  nothing for a five-category chart (decision 0239).
- **No flow metrics.** Average time at a stage needs a stage visit's
  **end**, and `stage_visits` records only `created_at`. Inferring it
  from the next visit is wrong for the last stage and for anything still
  in flight, so it wants a column and the engine writing it.
