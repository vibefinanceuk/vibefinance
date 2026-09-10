# 0198 — The screen sees what the route enforces

**Status: fixed.** `/field-visibility` takes a unit, and the viewer
passes the document's.

---

## Decision 0144, inverted

Decision 0197 let a unit override a stage's field visibility, and the
keying route enforced it. **`/field-visibility` did not take a unit at
all**, so the screen showed the group's answer.

A French keyer would see an editable field, type into it, and get a 403
on save.

**Decision 0144 found the opposite fault** — field visibility enforced
only by the screen since September, so a `curl` could write a read-only
field. This is that the other way round: **the route stricter than the
screen.**

Safe, and a trap. **A person cannot act on a box the system will
refuse**, and nothing would tell them why.

---

## Which meant loading the invoice first

`openViewer` fetched the fields and *then* the invoice — because until
decision 0197, **nothing about a document affected which fields it
offered.** Only the stage did.

Now the unit does, and the unit is a fact about the document. So the
invoice loads first and its `orgUnitId` goes with the request.

**That field has been reported since decision 0036 and read by
nothing** — the third time this week a value was stored, returned, and
never used: the line description (0171), the org unit on a document
(0193), and now this.

---

## Tested as agreement, not as two answers

The useful assertion is not *"the screen says read"*. It is that **what
the screen offers as editable and what the route accepts are the same
set** — asserted directly, rather than trusted because both call the
same function today.

Watched to fail: dropping the unit from the route reopens the trap.

---

## What is not built

- **Nothing else passes a unit.** The document manager opens the viewer
  with a document that knows its unit and the viewer refetches it, which
  is a wasted call rather than a wrong answer.
- **No screen configures an override**, still. It is a row.
- **`resolveFieldVisibility`'s unit is optional**, so a fourth caller
  will get the group's answer without being told. Decision 0192's risk,
  unchanged: forgetting does not fail.
