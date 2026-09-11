# 0252 — The count, and the list it links to

**Status: fixed.** A stage card counts what its click shows.

---

## Reported by clicking the card

> When I click on the card, it launches a task list with more values
> than the count value.

**Two faults, and only one was the mismatch.**

---

## The count was a product

`count(*)` after a `LEFT JOIN` to tasks, so **an invoice with three open
tasks counted as three** — and per-line evaluation makes that routine
(decision 0027): a stage scoped to evaluate once per invoice line raises
a task per line.

The number was neither instances nor tasks but the product of them.

**Tasks, now, because that is what the click shows** and what somebody
actually does. An instance sitting at a stage with nothing raised counts
once, as unclaimed — **a stage between tasks is still a stage with work
in it.**

---

## And the two asked different questions

The task list filters on **`t.stage_id`** (decision 0202). The card
asked **`pi.current_stage_id`**.

**A task can sit at a stage its instance has already left**, so the card
and the list were describing different queues and disagreeing about the
same screen.

The card asks the task's own stage now, which makes them agree **by
definition** rather than by both happening to be right.

---

## The segments add by construction

`unclaimed` was `count - mine - theirs`, which is arithmetic on a total
the query did not produce.

**A ring whose segments are derived from a total it did not produce is a
ring that can lie about the whole it divides.** The count is the sum of
the three now.

---

## And my first probe missed again

Reverting the join alone changed nothing, because one instance with
three tasks gives three rows either way — **the multiplication needs two
instances to show.**

The real discrepancy was the stage column, which no amount of breaking
the join would have revealed.

**Third time this week a probe of mine has been wrong rather than the
test** (decisions 0240 and 0251 being the others). Watching a test fail
proves the test works; it does not prove you understood the fault.
