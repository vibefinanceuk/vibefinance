# 0164 — The document manager

**Status: built.** Every document that has arrived, searchable, with the
columns a person chooses.

---

## The system could only show what went wrong

Found the day a photographed invoice was read automatically and reached
payment-eligible without anybody touching it:

> I have no way to query or view that document.

**Every way into a document was a task.** The task list shows work; the
viewer opens from a task. An invoice that went straight through has no
task, so it was **invisible** — correctly processed and unreachable.

Which means the system could show the documents that went *wrong* and
none of the ones that worked. That is the minority if the product does
its job.

---

## Straight through, counted

*"Straight through"* is the product's own claim and **nothing anywhere
said how many.** A `hands` count — how many people touched a document —
makes it a fact rather than a slogan.

Off by default, because most people arrive looking for one document
rather than for a statistic.

---

## A document nothing could read

It has no type, no number, no amount and no due date. **Four empty cells
say nothing**, so the row says what happened: *"could not be read
automatically"*, with who sent it.

Decision 0161 stores what was tried; this reports the consequence.

---

## Which columns, kept in the browser

At the operator's asking. **A column choice is a preference about one
screen on one machine**, not something worth a column on `org_users` —
and decision 0139's mood control settled the same question the same way.

Seven on by default: what it is, who sent it, how much, when, and where
it got to. Recipient, Due and Hands are real and specialised, available
rather than absent.

**Document and Expand cannot be turned off**: a row that cannot be
identified or opened is not a row. Their checkboxes show, disabled, so
the rule is apparent rather than mysterious.

---

## And an invoice outside a process is now read-only

Decision 0144 left this open and said so: *"an invoice that has left its
process is editable by anybody with `AP.Validate`."* **Nothing could
reach one**, so it stayed theoretical — until this screen made every
invoice openable.

The operator settled the rule:

> Anything paid should not be modified. Validation should determine the
> fields, matching and coding should assign the PO lines. There need not
> be any modifications after that.

**Editing belongs to a task.** A document nothing is working on is a
document nobody was asked to change.

That rule is otherwise **configuration**, not code: decision 0143's
`read_only` on Approval and everything after it, enforced by decision
0144. Nothing here hardcodes which stages those are.

### A better message, found by a test

An unknown field began reporting *"this stage does not permit editing
that"*, which sends somebody looking for a setting rather than a typo.
The vocabulary check explains it better, so an unknown field falls
through to it.

---

## Searching is done in the Worker, and that is a real limit

**The facts live in a JSON blob**, so a supplier name is not a column:
`LIKE` against `facts_json` would match the key as readily as the value
and find `BT-27` in every row.

So the route loads the most recent documents and filters those. The
screen says *"3 of the 50 most recent"* rather than implying it searched
everything.

---

## What is not built

- **The filter panel is not built.** The mockup has document type,
  status, sender, recipient and two date ranges; this ships search and
  columns.
- **Search reaches only what was loaded.** Fifty documents by default,
  two hundred at most. A customer with ten thousand invoices cannot find
  last year's.
- **No sorting.** Newest first, always.
- **The viewer opens with no actions**, which is right — this is a
  document being looked at, not work being done — and means somebody who
  spots a problem has no way to act on it from here.
