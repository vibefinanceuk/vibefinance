# 0222 — Finding a supplier by hand

**Status: built.** An unmatched Seller card is flagged, searchable, and
safe to ignore.

---

## The operator's whole requirement, and its last clause

> If an item reaches validation without a matched supplier... highlight
> the box with an amber ribbon... open a pop-out to search for the
> supplier using text that searches across fields... **However if not —
> the user can just leave it. To be picked up later in AP Review.**

**That last sentence shapes the rest.** An unmatched supplier is not an
error: the document may be from a genuinely new supplier, and the person
keying it has no way to create one — we are the mirror (decision 0208).

So the ribbon is **amber, not red**, and the pop-out says *"if this
supplier is not on file, leave it — the invoice will be reviewed
later."* **A box that only offers success makes somebody feel they have
failed at something they have not.**

---

## The ribbon already existed

Decision 0161's unreadable notice, whose own comment fits this exactly:

> nothing went wrong, and there is something for a person to do

Same three-pixel amber edge, same reasoning. **A second style would have
said the two situations were different**, and they are not.

---

## One box, not a form

Somebody looking at an invoice has **a name, or a VAT number, or an
address on the page** — and does not know which of those we hold.
**Asking them to pick a field first is asking them to guess what we
stored.**

So the search runs across name, ERP number, VAT id, endpoint, email,
street, city and postcode at once, and the caller types what they can
see.

**Pay sites come first**, because an invoice goes to one (decision
0218) and a person choosing by hand should not scroll past two
procurement sites to reach it.

**And each result shows everything searchable**, because since decision
0218 three sites of one supplier share a VAT number — **the address and
the *Payment* flag are the only things telling them apart.**

---

## Somebody said so is not the same as we found it

Choosing writes `supplier.chosenBy` with the caller's own id — derived,
never accepted from the body (decision 0010).

**Only one of those two claims could have been prevented by a rule**,
and an auditor wants to know which.

---

## What is not built

- **Nothing reads `supplier.chosenBy`.** It is recorded and no rule or
  screen consults it.
- **An inactive supplier is refused**, and there is no way to see why a
  supplier is inactive from the pop-out — only that it is absent.
- **No way to create a supplier**, which is the point: we are a mirror,
  and *"to be picked up later in AP Review"* is where that decision
  belongs.
- **Nothing re-runs the rules** after a supplier is chosen. An invoice
  routed to review for having none stays there, which is decision 0211's
  same gap at the other end.
