# 0255 — The card is the list, counted

**Status: fixed.** The stage card calls the route its click opens.

---

## The operator's four

> Approval shows 3 items on the card, and I can drill down into 4 owned
> by my user.

One query settled it: three of the four tasks sat on invoices with an
`org_unit_id`, and the fourth sat on an **unplaced** invoice — one with
none at all.

**The task list has shown those since decision 0202** — `if
(!task.orgUnitId) return true` — because a document that belongs to
nowhere is not a secret from anyone. **The card's scope clause said the
opposite**: a null unit is not `IN` any list of units, so it silently
dropped exactly the row decision 0204 most wants somebody to notice.

---

## Four records, one root cause

Decisions 0252 through 0254 each found the stage card's own query
disagreeing with the task list in a different way — a multiplication, a
wrong stage column, an idle instance, a missing join. **Each was real,
and none was the last one**, because the card was answering the same
question as the list with a second, independently written query.

**Two queries for one question will drift.** The only way a card can
promise to say what its click shows is to ask the click.

---

## So the card calls the route

`itemsAtStage` now calls `handleListMyTasks` — the same function the
click opens — and counts what comes back, using the list's own
`mine` / `available` / `locked` split rather than a parallel
computation of it.

**This is not a performance improvement.** It is slower than a single
`count(*)`. It is correct by construction, which four rounds of
targeted repair had not achieved.

### Which also fixed a bug in the list itself

`handleListMyTasks`'s own `counts` were computed over `all` tasks,
**before** the visibility filter ran — so a summary count could include
a task the row-level `maySee` check would hide. Found only because the
card now depends on that number being trustworthy on its own.

---

## What changed in the definitions, and why that is right

*Taken* used to mean *anyone else has it*. It now means **on a team I am
in, and somebody else has taken it** — because that is what the list the
card opens actually contains. A task owned outright by another person
was never in my task list and is rightly in none of the card's three
segments either.

*Unclaimed* means the same narrowing: a team queue, not merely absent.

**The card's segments now describe the list**, rather than describing
the database and hoping the list agrees.

---

## What is not built

- **No caching.** A stage card with several instances of `items_at_stage`
  now issues that many full task-list queries per dashboard load.
  Acceptable at today's volume; worth revisiting if a customer adds many
  stage cards.
- **`handleListMyTasks`'s `limit` parameter is used at 1000** to get an
  effectively unbounded count. A dedicated counting mode would be
  cleaner and was not built, to keep this change to the minimum that
  fixes the disagreement.
