# 0114 — Which fields a person sees

**Status: built** — the configuration, the resolution, and the routes.
**Not built:** the viewer using it; the screen still has a hardcoded
list.

---

## Why it is needed now

The vocabulary carries every mandatory term of an invoice, after
decisions 0110 and 0112 added twelve. The operator's framing:

> If we put all of the fields on the screen it would be very busy. Any
> fields like an ID may not be relevant to the user.

A complete vocabulary and a usable screen are different things. The
first is required for rules to reference; the second shows a fraction.

---

## Three states, not two

`edit`, `read`, `hidden` — and **the middle one is the point**.

BT-126 is a line identifier somebody refers to when talking to a
colleague and never types. BT-27 is the seller's name, which a person
reads to confirm they have the right document and does not key. Hiding
either loses something; offering them for editing invites a change
nobody wants.

---

## A stage may restrict, never grant

The operator's reasoning, and the sharpest line in this decision:

> When the invoice gets to approval, we might have fields visible, but
> not editable. **Approvers should approve data, not edit data.**

That is a **control**, not a preference. An approver who can change the
amount they are approving has defeated the point of approval.

So a stage can tighten `edit` to `read`, and cannot loosen `read` to
`edit`. Enforced three ways, deliberately:

- The `CHECK` on `stage_field_visibility` **refuses `'edit'` outright**,
  so no route can write one however it is called.
- A standing invariant restates it, so relaxing the constraint later is
  caught.
- The resolver applies a restriction **only when it is genuinely
  stricter**, so a stage saying `read` about a hidden field does not
  reveal it. Watched to fail — a restriction that widened would be a
  grant wearing another word.

---

## Absence means a default

A customer who configures nothing gets a working screen. **Nobody should
have to seed forty rows before anything renders.**

The defaults come from the standard rather than invention: a term BIS
Billing 3.0 marks mandatory is one somebody keying an unreadable
document has to be able to supply, so it defaults to `edit`.
Identifiers and codes default to `read`. **Everything else is hidden** —
the safer direction, since a field nobody chose to show is one nobody
has to scan past, and a customer who wants it says so.

---

## It says who decided

`decidedBy` is `default`, `customer` or `stage`.

*"Why can I not edit this"* deserves an answer, and *"the Approval stage
restricts it"* is a different answer from *"nobody has configured it"*.
One is a decision somebody made; the other is a decision nobody has.

---

## Hidden fields are omitted, not sent as hidden

A client that received them could render them by mistake, and **there is
nothing a screen can do with a field it must not show**.

Watched to fail. It is also presentation rather than security, the same
as decision 0103's task actions: hiding a field does not stop anybody
keying it through the API — `AP.Validate` does that.

---

## What is not built

- **The viewer does not use it.** Its eight header fields and five line
  fields are still a hardcoded list, so this is configuration nothing
  reads — the pattern this project finds most often, recorded here
  before somebody else finds it.
- **No org dimension.** The conversation that began this asked for
  variation by org too, and decision 0111 has since made an invoice
  carry one. Deliberately left out: customer and stage cover the cases
  actually described, and a third dimension is easier to add than to
  remove.
- **The expense vocabulary.** `INVOICE_FIELDS` only. An expense screen
  would want the same mechanism against `EXPENSE_FIELDS`.
- **No interface for configuring it.** Two `PUT` routes, no screen.
