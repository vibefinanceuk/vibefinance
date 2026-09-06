# 0120 — Reading an invoice back

**Status: fixed.** Reported from the screen: *"I click save, it says
saved, I leave the screen and re-enter, and it's empty again."*

---

## The save worked. Nothing read it back.

**There was no route to read an invoice.** It could be keyed, placed in
an org, given a document and a signed URL for it — and not fetched.

So the keying screen built its values from the **task list's summary
row**: five fields carried for a queue, supplier, currency, issue date
and total. Everything else somebody typed, and every line, had nowhere
to come back from.

A person keys ten fields, saves, returns and sees five. **Concluding it
had not saved is the correct inference from what they were shown.**

---

## Why it looked reasonable when it was written

The task list already carried a `subject` block, and the viewer needed
values. Reusing it cost nothing and worked for the fields it happened to
contain.

**It stopped working the moment the screen offered more than the summary
carried** — which was decision 0114, when the fields became configurable
and any declared field could reach the screen. The summary was fixed at
five and the form was no longer.

That is the shape this project keeps finding, in a new place: **a real
mechanism, pointed at a set that used to be the right one.**

---

## What it returns

The **facts**, in full, rather than the columns. Decision 0109
established that the columns are a convenience copy and the facts are
the truth — and per-line facts are what a rule tests and what the keying
screen edits.

Lines come back with their facts too, so a keyed line reappears.

And `orgUnitId` with `orgAssignedBy`, since a screen showing an invoice
should be able to say where it belongs (decision 0111).

---

## An unparseable row still returns

A `facts_json` that cannot be parsed yields empty facts and a 200, not
an error.

**The row still has an identity and lines**, and refusing to return it
would hide a document somebody needs to look at — the opposite of what
this system does with a document it cannot read (decision 0063).

---

## What this says about the tests

`vf-ui` has 43 tests and **not one of them runs the browser code.**
They cover the Worker: routing, proxying, cookies, the markup it serves.
`vitest-pool-workers` runs in `workerd`, which has no DOM.

So the panel rendering, the field highlighting, the tooltips, and this
bug were all outside anything the suite could see. **It was found by
somebody using the screen**, which is how most of this project's real
defects have been found — and which does not scale.

Choosing a runner for browser code is a decision nobody has made:
`jsdom` is quick and approximates a browser; a real browser through
Playwright is slower and tests what actually happens.
