# 0169 — A list of questions with none of the answers

**Status: fixed.** What each detection test found now reaches storage.

---

## The diagnostic never left the function

Decision 0168 added the opening bytes to a failed image sniff, so the
next document would say what actually arrived. The next document said:

```
intake.attempted: "pdf_header,xml_declaration,image_magic_bytes"
```

Exactly as before.

**`summariseAttempts` stores the names of the tests that ran and
discards what each one found.** A list of questions with none of the
answers.

---

## The third time in one day

- **Decision 0162** — a refused attachment reported `unreadable` while
  the reason sat in `result.body`, thrown away by the caller.
- **Decision 0168** — a failed sniff reported `unrecognised` while the
  bytes were in hand.
- **This** — the outcome reached storage's door and was summarised out
  of existence.

Each layer knew something, said a word instead, and the word travelled.
**Three different authors of the same mistake, and all of them were
me.**

---

## The contract stays

`intake.attempted` is comma-separated **on purpose**, matching
`validation.failures` so the existing `contains` operator applies and no
new operator was needed. A customer's rule may depend on that shape.

So the answers go in a **separate field**, `intake.detail`, and only on
a document nothing could read — because that is the only time anybody
asks.

**Diagnostic rather than something to write a rule against**, and the
vocabulary says so: the wording is ours and may change, where
`intake.attempted` is a contract.

---

## And a table nobody had classified

Decision 0150's `process_stage_versions` was in the skeleton and in
neither list, which decision 0118's check caught.

**Configuration, beside the stages it describes.** Which stages are in a
process at a given version is the same kind of fact as the stages
themselves — a production environment without it has instances pointing
at a version that does not exist.

I put it in the non-migrating list first, with a comment arguing it was
configuration. The comment was right and the placement was wrong.

---

## What is not built

- **The cause of the unrecognised image**, still. This is the second
  piece of instrumentation for the same question, and the first one that
  will actually be visible.
- **Nothing records the declared content type** beside what the bytes
  turned out to be. A disagreement between the two remains the clearest
  signal available and is not captured.
