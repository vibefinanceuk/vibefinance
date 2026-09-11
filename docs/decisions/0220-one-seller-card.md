# 0220 — One Seller card

**Status: built.** The supplier record lives inside the Seller panel,
not beside it.

---

## Screen real estate is the reason, and it is a good one

> You have created a new *Supplier on File* card. I would have liked the
> information to be merged into the existing card that read Seller at
> the top... importantly reuse the Seller section because of
> screen real-estate constraints.

**Decision 0219 added a second panel** and did not ask what it cost. A
viewer showing the document and the form side by side has **no room for
a card that repeats what the card above it says differently**.

---

## Matched or extracted, never both

**Matched, the card shows our record.** Name, VAT, electronic address
and email on the left; street, city, postcode and country on the right.

**Unmatched, it shows what the document said** — the extracted seller
fields, as it always did, with a sentence saying which of three things
happened.

**Never both**, and that is not only about space. The two answer the
same question, and showing them together makes a person compare **them**
rather than comparing our record against **the image** — which is the
comparison the operator asked for.

### What that costs

**A matched invoice can no longer have its seller fields keyed** from
this card.

**Which is defensible**: the invoice matched *on* those fields, so
extraction read them correctly. A wrong VAT number would not have found
a supplier.

**Not free, though.** A seller's country could be wrong while the VAT id
was right, and there is now no way to correct it here. Recorded rather
than argued away.

---

## And the card keeps its place

The panel is in the same position whether or not a supplier matched.
**A card that appears and disappears makes a person hunt for it**, and
the unmatched case is the one where they are looking hardest.

---

## What is not built

- **No way to choose a site** when the card says the match was
  ambiguous. It explains and offers nothing.
- **Nothing acts on the hold**, which the card shows with its reason.
- **`viewer.supplier` is now an unused string**, kept rather than
  deleted: one a customer may have translated is not something to remove
  in passing, and an unused row costs nothing where a missing one shows
  a key on screen.
