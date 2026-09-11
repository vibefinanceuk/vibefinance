# 0251 — An empty stage is not a deleted one

**Status: fixed.** A stage card for a quiet queue names its stage.

---

## Reported by adding a card

> When I add the AP stage — I get this message.

*"This stage no longer exists. Choose another, or remove this card."*
About a stage the save had **just verified existed** (decision 0243
refuses one that does not).

The query asked `process_instances` and joined the stage to it, so a
stage holding nothing produced `stage_name = NULL` — and the card read
that as *no stage*.

**Decision 0241 was the same shape**: a zero and an absence sharing a
representation. **Second time**, and the first one is eleven records
ago.

---

## Two questions, asked separately

**Does this stage exist** is a question about the stage, and it is asked
of `process_stages`.

**How many are here** is a question about instances, and it returns zero
without saying anything about whether the place exists.

---

## And my first attempt to break it did not

I reverted `missing` to `!row` and the tests stayed green — because **an
aggregate without `GROUP BY` always returns one row**, so `row` was
truthy even for a stage with nothing in it.

The real mechanism was the **inner join** making `stage_name` null
inside that one row.

**Reproducing it needed the actual shape**, not an approximation of it —
and the second time this week a probe of mine has been wrong rather than
the test (decision 0240 was the other).

**Which is worth stating**: watching a test fail is only evidence if the
thing you broke is the thing that was broken.
