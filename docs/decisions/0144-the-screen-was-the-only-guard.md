# 0144 — The screen was the only guard

**Status: built.** Field visibility is enforced by the route, not
merely displayed by the screen.

---

## The report

> In approval I am able to open an item, add a line, and save the line.

Decision 0143 had just made the stage read-only, and every field on that
line rendered as text. The line was still added, and still saved.

**Two separate faults**, and the second is much older than the first.

---

## Adding a line is not editing a field

Field visibility governs **fields**. Adding and removing a line changes
the **shape** of the document, and nothing governed that at all.

So the add and remove controls now appear only where something can be
edited — the same condition decision 0142 applied to Save, for the same
reason: a control that changes something on a screen that changes
nothing is a promise the stage will not keep.

---

## And the route never checked

**This is the real finding.** Decision 0114 gave a stage the power to
restrict a field in September, and `handleKeyInvoiceFields` **has never
consulted it**.

Every restriction since has been a screen behaviour. A `curl` could
always write a read-only field — and once decision 0142 let the viewer
serve every stage, a browser could too.

**A screen that hides a field is a courtesy; a route that refuses one is
the rule.** The project already knows this: decision 0010 derives
identity from the authenticated caller and proves it with a test sending
a spoofed one. Visibility was the same shape and nobody had noticed.

### The stage is derived, never accepted

`/invoices/:id/key` is not stage-scoped, so the stage comes from **where
the invoice actually is** — its in-progress process instance. A stage id
in the request body would let somebody key at whichever stage suited
them, which is the spoofed identity again in a new coat.

### Refused, not ignored

Silently dropping a field a stage does not permit would tell somebody
their edit was saved when it was not — the failure decision 0119 spent a
day on from the other direction.

**The refusal names the fields**, because *"some fields were refused"*
sends a person hunting.

### And an invoice in no process is unrestricted

Which is what every caller predating this got. A document never put into
a process has no stage to ask, and inventing a restriction for it would
break the inline testing path decision 0071 keeps deliberately.

---

## What this says about the pattern

`PROGRESS.md` records it: **an admin route proves nothing about effect,
and a passing unit test proves nothing about wiring.**

Add one: **a screen proves nothing about a rule.** Decision 0114's tests
all passed, its resolver was correct, and the thing it existed to
prevent was possible from the first day by anyone who skipped the
browser.

---

## What is not built

- **Only keying is checked.** Any other route that writes a fact —
  capture, evaluation's corrections — resolves no visibility, and the
  argument for keying applies to them.
- **Nothing tells the screen why.** A 403 with `not_editable_here`
  reaches the viewer, which shows the raw `error` rather than words from
  D1 (decision 0132's gap, still open outside the sources screen).
- **A stage with no process instance cannot be restricted**, which is
  correct and also means an invoice that has left its process is
  editable by anybody with `AP.Validate`.
