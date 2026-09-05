# 0116 — Codes the standard does not know

**Status: built.** A sixth validation check, and the detail a person
needs to act on it.

---

## What was missing

Decision 0113 built the standard's code lists and **nothing checked a
document against them.** A supplier's UBL carrying
`currencyID="EURO"` is non-conformant, and it was stored happily.

The framing from that record:

> A dropdown stops a **person** entering a bad code; validation stops a
> **document** carrying one.

The dropdown was the smaller half.

---

## `code_list`, alongside the arithmetic

`VALIDATION_CHECKS` gains a sixth name, and the naming matters for the
reason decision 0044 gave: *"validation failed" is far less useful to a
rule author than knowing which check failed.*

This one says something different from its neighbours — not *"these
numbers disagree"* but *"this is not a code the specification
recognises"* — which is a different problem with a different remedy.

A customer can now write: *"if validation failures contains
`code_list`, assign a task to the AP team."*

---

## Only closed lists, and that is the whole subtlety

`isClosedList` exists for exactly this (decision 0113). UN/ECE
Recommendation 20 runs to hundreds of units and the vocabulary carries
the two dozen in ordinary use — so a document using a becquerel is
**unfamiliar, not non-conformant**.

**Enforcing the subset would reject valid invoices** for using a unit
nobody anticipated, which is worse than the problem being solved.
Watched to fail: removing the `isClosedList` guard breaks the test that
accepts an unusual unit.

Currency and VAT category *are* the standard in full, so those are
refused.

---

## An empty value is absent, not invalid

Intake writes an empty string when it could read nothing (decision
0063), and calling that a bad code would **flood every unreadable
document with failures it cannot act on** — the documents most in need
of a person's attention, buried in noise about fields nobody has typed
yet.

Absence already has a check. `total_missing` is that check.

---

## It says which code, and where

`code_list` in `failures` says a code is wrong; `invalidCodes` says
**which one**.

```
["BT-5=EURO", "line 2: BT-151=NONSENSE"]
```

*"One of your lines has a bad VAT category"* is not something a person
can act on across forty lines. The line number is part of the answer.

The keying screen reports it after saving, so the person who has the
document open is the one who sees it.

---

## It always runs

Unlike the arithmetic checks, which need particular fields and are
skipped without them, this one runs on every document. A document
carrying no coded field at all **passes it honestly, having genuinely
been checked** — which is the distinction `checked` versus `passed` was
built to preserve.

An existing test asserting exactly which checks ran caught this
immediately, which is the test doing its job.

---

## What is not built

- **Closed-value enforcement in the compiler.** The other half, still.
  A rule saying *"currency is EURO"* compiles, activates, fires against
  nothing and looks correct in every listing. `validateRule` has the
  list and does not consult it.
- **Nothing re-validates on demand.** A document captured before this
  existed keeps whatever verdict it had; validation runs at capture and
  on keying, and there is no *"check this again"*.
- **The other coded fields** BIS defines — invoice type, payment means,
  allowance and charge reasons, country. `FIELD_CODE_LISTS` maps three,
  and adding a fourth needs only a list.
