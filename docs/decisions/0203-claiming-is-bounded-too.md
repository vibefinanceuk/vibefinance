# 0203 — Claiming is bounded too

**Status: built.** A task about a French invoice cannot be claimed by
somebody holding the permission only in Germany.

---

## The last place the boundary was a screen

Decision 0202 stopped **showing** a German validator French work.

**The claim route still let them take one by its id.** Which is decision
0144's fault exactly, and that record's own words: field visibility was
*"a screen behaviour since September — a `curl` could always write a
read-only field."*

A boundary that only hides is not a boundary. It is a suggestion with
good manners.

---

## Where, from the document

The route already loaded the task's `required_permission`. It now loads
the **document's unit** with it — through the stage visit and the
process instance — and asks `hasPermission` where rather than only
what.

**A task about no document, or a document in no unit, passes `null`**,
which asks *"at all"* and is what every task did before decision 0199.

---

## Two 403s that look the same

The first version of this test asserted `not.toBe(403)` for the
permitted case, and **passed while being wrong**: the claim was refused
for **team membership** rather than for the org, and the assertion could
not tell them apart.

**Fixed by making the permitted person a real member**, so a refusal is
about the org and the test asserts `200` rather than *not one particular
failure*.

**A test that cannot distinguish two failures is a test that passes for
the wrong reason** — the same class of thing decision 0165 recorded when
a stub returned a plausible success.

---

## What is not built

- **Twelve of fourteen permission checks still ignore the unit.**
  Keying, approving, returning, rule management and the rest ask *"at
  all"*. Two now ask *where*: claiming, and completing through the same
  route.

  **They are the two that matter most** — claiming is how work is taken,
  and completing is how it is finished — and the rest are a list, not a
  principle.
- **Nothing tells a person why.** A refused claim says *forbidden*, and
  a German validator who reached a French task by its id learns nothing
  about which org it belongs to.
- **Teams and settings remain customer-wide** (decision 0192).
