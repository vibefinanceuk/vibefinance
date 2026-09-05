# 0109 — Keying lines

**Status: built.** The viewer has an editable line table, and a typed
line is now distinguishable from an extracted one.

---

## What was actually missing

Less than expected. **`key-fields-route.ts` already accepted
`body.lines`** and passed them to the ordinary writer, so keyed lines
have always been storable.

What was missing is any record that **a person typed them**.
`keyed_fields` was keyed by invoice and field with no line reference, so
a typed line amount was indistinguishable from an extracted one.

That matters for the same reason header provenance does (decision
0071). An auditor asking *"who put this figure here"* needs an answer,
and a rule testing `provenance.keyed` needs the line case to appear
there at all.

---

## One trail, not two

`keyed_fields.line_number`, nullable, where **NULL means a header
field**.

Chosen over a separate table because the question somebody asks is
*"what did a person type on this invoice"* — one trail, read together. A
second table would make every audit query a union, and the two would
drift in exactly the way these records keep finding.

Recorded as `line.<n>.<field>` in the same `provenance.keyed` list, so a
rule testing it with `contains` sees header and line alike.

---

## Two things the header case never faced

**Keying only lines was refused.** The guard required at least one fact,
because `facts` was the only thing keying could mean when it was
written. Somebody typing a line table and no header field — exactly the
case this screen exists for — got a 400.

**And an empty batch is a D1 error.** Now reachable, because somebody
may open a line table, save, and have changed nothing. That is a
legitimate no-op rather than a failure.

Neither was a design flaw. Both are what happens when a feature meets
the shape of the one before it.

---

## Only what changed

Somebody opening a line table and saving without editing should **not
appear to have typed every figure on the invoice**. The route compares
against what is stored and records the difference.

---

## The line number comes from the line

Found while building: the writer **requires an explicit `lineNumber`**
and refuses without one. The first version of this code inferred it from
array position.

The writer's design is better and was kept: a caller says which line it
means, rather than relying on array order surviving a round trip.

---

## The viewer sends every line, not the changed ones

`handleUpsertInvoice` **deletes all lines and reinserts**, so a subset
would delete the rest.

The client sends the whole table; the server works out what changed.
That division is right anyway — the client should not have to know what
it started with in order to describe what it now believes.

---

## The running comparison is advisory, and says so

The lines' sum against the printed total, updated as either is typed.

**It never blocks.** An invoice whose lines do not sum to its printed
total is a fact to record faithfully, not an input to prevent — the same
principle decision 0072 established for validation, now applied
somewhere a person can see it.

It colours differently when they disagree, and saving works regardless.
That is one of the three things decision 0108 left open, answered in one
direction by one screen rather than settled generally.

---

## What is not built

- **Line-level fields beyond description and amount.** `invoice_lines`
  carries `cost_centre` and a `facts_json`, and BT-133 exists in the
  vocabulary. The screen offers two columns because those are what a
  person reading a paper invoice can supply without a mapping.
- **Reordering.** Removing a line renumbers the rest, since the number
  is positional on save. Somebody who deletes line 2 of five changes
  what lines 3 to 5 are called, and the provenance trail records the
  numbers as they were at the time.
- **Any check that lines belong to the invoice they claim.** The writer
  replaces the whole set for one invoice, so the question does not
  arise — but it would if lines were ever patched individually.
