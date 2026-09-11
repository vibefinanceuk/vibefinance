# 0248 — A ring has no width to mean anything with

**Status: fixed.** The donut's legend, and a due date nobody says out
loud.

---

## Five dots and not one word

`svg()` kept `width: 100%` even for a chart marked `fixed`, so the ring
took the whole flex row and **the legend was squeezed to zero** — five
coloured dots in a column, and every name and number gone.

**Decision 0245 made charts fill their card, and that is right for
bars**, whose meaning *is* their width: a taller bar against a wider
card still compares the same way.

**A ring has no width to mean anything with.** It is a circle; making it
wider only makes it bigger, and the space it takes is space its legend
needed.

**Fixed now means fixed in both directions**, which is what the flag
always claimed.

---

## And the test now asserts the words

The first version counted `circle` elements, which were all present and
correct — **the ring was drawn perfectly and nobody could read it.**

It reads the legend rows now:

```js
expect(keys).toEqual(["Validation8", "Approval11"]);
```

**A chart that draws and cannot be read passes every structural
assertion there is**, which is the third time this month the check and
the fault have missed each other — decisions 0223, 0235 and 0241 being
the others.

---

## "Due today", not "due in 0d"

Zero days is **a number nobody says out loud**, and on the card that
decides what to pay it is the most urgent row there is.

It should not read like an arithmetic result.

---

## What the screenshots have been worth

**Every visual fault in this dashboard was found by the operator
looking at it**: the void beside the first tile, the chart adrift in its
card, the amber bar at full width, the ragged rows, and now a legend
that was not there.

**None of them failed anything.** I do not see rendered output, and the
model I reason with has been wrong about each one in a different way.
