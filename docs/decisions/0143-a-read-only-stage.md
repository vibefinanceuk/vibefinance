# 0143 — A stage that is read-only

**Status: built.** A property of the stage, replacing a list somebody
has to keep complete.

---

## Found on the screen, immediately

Decision 0142 made the review screen the validation screen, and said the
last step was data: configure Approval as read-only.

Three header fields were set to `read`. Then:

> In approval I am able to change line field information and click save.

**The list was incomplete**, and that is the smaller half of the
problem.

---

## A list is the wrong shape for this

*"Approvers should approve data, not edit data"* — decision 0114's own
words — is **a statement about the stage**, not about a set of fields
that happen all to be read.

Expressed as a list it fails twice:

**Somebody has to name every field**, and header and line fields are
separate sets. Naming three of one and none of the other leaves lines
editable, which is exactly what happened.

**And a field added to the vocabulary next month is editable there.** A
list cannot know about a field that did not exist when it was written,
and nobody would find out — the screen would simply offer an approver
something new to change.

That is the shape decision 0107 records about hand-maintained lists, and
the fix is the same: **derive rather than enumerate.**

---

## Still restrictive-only

Decision 0114's central rule is that a stage may **tighten and never
loosen**, enforced by a `CHECK` refusing `'edit'` in
`stage_field_visibility`.

A read-only stage turns `edit` into `read` and **leaves everything else
alone** — a hidden field stays hidden. Watched to fail: dropping the
`edit` condition makes a read-only stage reveal fields the customer
chose to hide, which would be a stage loosening under the guise of
restricting.

---

## And it sits beside the per-field mechanism

Both apply, in order: the stage's own answer first, then any field the
stage names specifically. A stage can be read-only **and** hide a field
it does not want an approver to see.

The route reports **how many fields it actually covered**, because
somebody making a stage read-only wants to know it reached everything —
counted rather than asserted.

---

## What is not built

- **Nothing sets it in the interface.** `PUT
  /processes/stages/:id/read-only` exists; the sources screen has no
  equivalent for stages, and process configuration is still `curl`.
- **A read-only stage still shows a Save button** if any field escapes,
  which is now impossible by construction — but the viewer decides from
  the fields it received rather than from the stage's own flag, so a
  future field type that bypasses the resolver would reopen it.
- **Nothing warns that a stage with tasks has become read-only.**
  Somebody mid-keying would find their fields turn to text on the next
  open, with no explanation.
