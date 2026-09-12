# 0256 — The second select with the same fault

**Status: fixed.** The ownership dropdown shows the filter it opened
with.

---

## Reported by using it

> The default drop-down rests on Everything. This makes the user think
> this is everything available, and does not match the card.

Clicking a stage card opened the task list correctly filtered to
*mine*. The dropdown read **Everything**, so five filtered rows looked
like five total.

---

## Decision 0254 fixed exactly this, for the other select

That record found a `select`'s `value` set at construction, before any
`option` existed to bind to, and fixed it for `stages`:

```js
stages.value = filters.stage;
```

**`ownership` sat two lines below it in the same function, with the
identical fault**, and was not touched.

---

## And the fix needed the real call sequence to test

`openTasksFiltered` is only ever invoked from a dashboard already
running, where `start()` has populated the signed-in person. The first
version of this test called it cold, hit a null `me`, and failed for a
reason that never occurs in real use.

**Calling `start()` first** — as the app itself always does — was the
correction, not a workaround.

**And the stage-select test needed a task in its stub.** `stages` only
offers stages it has actually seen (`knownStages`), unlike `ownership`'s
four fixed options — so a fixture with no tasks correctly has no
`approval` option to select. The file's own `APPROVAL_TASK` fixture, one
scroll up, was already exactly what both tests needed.

---

## What this says about decision 0254

**A fix applied to one of two identical constructs and not audited
against its twin.** Nothing here required new understanding; it required
reading the four lines below the ones already changed.
