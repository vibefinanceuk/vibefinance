# 0070 — The response says what was stored

**Status: built.** A small change, prompted by how decision 0069's bug
had to be found.

---

## What prompted it

Decision 0068 retained the captured document and reported:

```json
"document": { "retained": true }
```

That was **accurate** while the document was being stored as
`application/octet-stream` under a `.bin` key — the bug decision 0069
fixed. The response said the truth and said nothing that would have
revealed the problem.

It was caught only by querying `invoice_documents` directly. Nothing
about the capture, in the shape it reported, would have prompted anyone
to look.

---

## The change

```json
"document": {
  "retained": true,
  "contentType": "application/pdf",
  "key": "Acme/2026/5ec9752c-....pdf"
}
```

Two fields, present only when something was actually stored. A key for
an object that does not exist would be worse than no key at all, and a
test asserts both are absent on every failure path.

---

## Why it is worth a decision record

`docs/PROGRESS.md` already carries the working note *"instrument the
boundary with the real payload"*, learned over six attempts at one
extraction bug. That note is about **diagnostics**. This applies the
same reasoning to a **response**:

> A caller told only that an operation succeeded cannot see how it
> succeeded. Reporting the outcome's own shape — what was stored, where —
> puts the next mistake of this kind where somebody is already looking.

The specific gain: a mis-typed document is now visible in the `curl`
output rather than requiring a database query and a reason to suspect
one.

---

## What it does not solve

Reporting more does not make the value correct — decision 0069 did that.
This makes the *next* one findable, which is a weaker and more durable
kind of help.

Nor does it apply anywhere else yet. The channel-addressed capture
endpoints report nothing about retention because they retain nothing
(decision 0068), and the multi-page flow's own storage is a separate
question.
