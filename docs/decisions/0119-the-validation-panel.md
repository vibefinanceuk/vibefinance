# 0119 — The validation panel

**Status: built.** Exceptions in a panel, failing fields highlighted,
each explaining itself on hover.

---

## What it replaced

**One line of text, after saving.**

```
Saved. Still failing: vat_arithmetic, code_list (BT-5=EURO).
```

Four things wrong with that, and one of them was mine.

**`vat_arithmetic` is an identifier a rule tests.** Decision 0044 named
the checks deliberately, because *"validation failed"* tells a rule
author nothing — but it is not what somebody keying an invoice should
read. The same problem `field.bt-129` had on a live screen.

**The English was built in JavaScript.** *"Saved. Still failing:"* was a
literal, so a German customer read it in English — exactly what decision
0107 exists to prevent, in a line I wrote after building 0107.

**Nothing pointed at anything.** `vat_arithmetic` does not say which
three amounts disagree, though the check compared BT-106, BT-110 and
BT-112 and knew perfectly well.

**And it appeared only after saving.** A person keyed eight fields,
saved, and then learned the VAT did not add up.

---

## Each check reports the fields it compared

`failures` stays a list of check names, because that is what a rule
tests. `involves` is new, and is what a screen needs:

```json
{ "check": "vat_arithmetic", "fields": ["BT-106", "BT-110", "BT-112"] }
{ "check": "code_list", "fields": ["BT-151"], "line": 1, "value": "NONSENSE" }
```

**Reported by each check rather than mapped afterwards.** A static table
of check-to-fields would be a second place the same knowledge lived, and
would drift the first time a check changed what it compared — which is
this project's most frequent finding.

**All three amounts, not one.** `vat_arithmetic` cannot know which of
the three is wrong, and highlighting one would assert something it has
not established.

**One entry per bad code**, not one for the check. A document with two
invalid codes highlights two fields and explains each; `code_list` once
would point at neither.

---

## The panel is fixed and scrolls

The operator's specification, and the reason holds up: **a document with
fourteen exceptions must not push the fields it is complaining about off
the screen.** The panel is a companion to the form, not something that
displaces it.

---

## The reason travels with the highlight

A failing field carries the check's own label as its tooltip.

**A red box that does not explain itself** makes somebody hunt through a
list to work out which of fourteen exceptions is theirs — which is worse
than no highlight, because it looks like help.

The panel names the fields too, so somebody can read it and know where
to go **without** hovering anything. Hovering is the shortcut, not the
only path.

---

## One source, not two

`exceptions` is held once, and both the panel and the highlighting draw
from it.

A field marked as failing and a row explaining why **must never
disagree**, which they would the moment each kept its own copy.

Cleared when the viewer opens, so one document's exceptions never appear
against another.

---

## A field the stage does not show is not an error

Field visibility (decision 0114) means a check can fail on something
this stage hides. The exception still appears in the panel; only the
highlight is absent.

Silently dropping the exception would be worse: **the document is still
wrong, and the person still needs to know**, even if fixing it is
somebody else's job at another stage.

---

## The panel was empty, and the reason is instructive

Reported after deploying: *"the error appears below the lines table — I
thought we are posting exceptions in the Exception box."*

The panel rendered, in the right place, showing nothing. **The keying
route assembles its validation block field by field**, and never carried
`involves`:

```ts
validation: {
  passed: verdict.passed,
  checked: verdict.checked,
  failures: verdict.failures,
  advisory: true,
}
```

The validator gained a field and this did not. **A test on the
validator passed, a test on the route did not exist, and the screen
showed nothing** — the same shape as decision 0105, where
`authenticateUserOrSession` worked and nothing tested which routes
called it.

Now carried, and named explicitly rather than spread: a spread would
pass whatever the validator happens to return, including things a
caller has no business seeing. **The tests are on the route**, which is
where the gap was.

---

## It says what is wrong on arrival

Reported from the screen: the panel read *"Nothing to resolve"* on a
document with two failures.

Correct, and useless. **It filled only after saving** — so a person
opened a document, was told there was nothing wrong, and had to change
something before being told what was wrong. Reading an invoice
(decision 0120) now reports how it validates as it stands.

Computed rather than stored, and **advisory** like every other verdict
this system reports (decision 0072): re-running validation is not
re-evaluating rules, and nothing here moves the process.

---

## And one thing that reads as an exception and is not

*"Lines total 150.00 · differs by 30.00"*, below the line table, was
read as an exception on the screen. It is the **running comparison**
from decision 0109 — live feedback as somebody types, updating on every
keystroke.

The panel reflects a verdict; the comparison reflects the form. They
are genuinely different things and sit apart for that reason — but
**the distinction was not obvious to the person looking at it**, which
is worth knowing before deciding it is right.

---

## What is not built

- **The header arithmetic does not recalculate as somebody types.** The
  lines do, and the header waits for a save. Half the original
  complaint, and the panel now exists to receive the other half.
- **`checked` versus `passed` is not shown.** The API distinguishes *"we
  checked and it was fine"* from *"we could not check"* (decision 0044),
  and the panel shows only failures. A person cannot see that the line
  sum was skipped for want of lines.
- **No severity.** Every exception reads alike, though a missing total
  and an unfamiliar code are not equally urgent.
