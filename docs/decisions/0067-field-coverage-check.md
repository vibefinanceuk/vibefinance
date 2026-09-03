# 0067 — A test that crosses the boundary

**Status: built.** `shared/interpreter/field-coverage.test.ts`. Proposed
by decision 0059.

---

## The bug this exists to catch

One layer disagreeing with another, five times:

| Divergence | Consequence | Found in |
| --- | --- | --- |
| `cost_centre` a column with no vocabulary entry | No rule could reference a real value | 0031 |
| `extraction.confidence` set and never declared | The rules meant to use it could not be written | 0054 |
| Settings configured and reaching nothing | Every value an administrator set was ignored | 0056, 0057 |
| The UBL parser populating 11 of 21 fields | Validation's arithmetic checks could never run on the *exact* path | 0059 |
| A constant claiming FatturaPA is a CIUS | A list inviting entries to be treated identically when they cannot be | 0065 |

**None was found by reading either layer alone.** Each came from asking
whether one layer agreed with another — and each time, the question was
asked by accident.

---

## What it asserts

For every field the closed vocabulary declares: the UBL parser populates
it, **or** the file records why it does not.

```
Declared in the vocabulary and populated by no intake path: BT-12.
Either map it in shared/ingestion/ubl-parser.ts, or add it to
DELIBERATELY_UNMAPPED in this file with the reason. A field nothing
can produce is a rule nobody can write.
```

The exemption list is as much the point as the assertion. `BG-20` and
`BG-21` are genuinely hard — repeated nested groups with their own reason
codes, amounts and tax categories, not a path-to-scalar mapping — and no
rule has needed them. **A gap has to be stated to be allowed**, which
turns "nobody noticed" into "somebody decided".

---

## Three guards against the check rotting

A coverage test that quietly stops covering anything is worse than none,
so three further assertions defend it:

- **No stale exemptions.** A field listed as unmapped that is now mapped
  means a comment claiming a limitation that no longer exists.
- **No exemptions for fields the vocabulary no longer declares.**
- **The check actually finds something.** It asserts `BT-1` is detected
  and that more than ten fields are found — because a regex that matched
  nothing would pass the main assertion vacuously and for the wrong
  reason.

Watched to fail: declaring `BT-12` without a mapping breaks it, with the
message above.

---

## Where it lives, and one small consequence

In `shared/`, because it reads both the vocabulary and the parser, and
both are there.

It reads the parser's **source text** via Vite's `?raw` rather than
`node:fs` — this package targets the Workers runtime, and pulling Node's
types in for one test would widen its type environment for no good
reason. That needed a one-line `raw-imports.d.ts`, matching the one each
Worker's test folder already has for `.sql`.

Reading source rather than behaviour is a real limitation: a parser that
assigns `facts["BT-12"]` inside dead code would satisfy this test. The
alternative — parsing a fixture containing every field and checking the
output — would be stronger and needs a fixture that does not exist.
Worth doing if this check ever gives a false pass.

---

## What it does not cover

Only the UBL path, and only invoice fields.

The image path's coverage is the extraction schema's business, and its
fields are asked for by prompt rather than mapped. Expense fields have
their own vocabulary and no parser. Neither is a reason to delay the
check that can be written.
