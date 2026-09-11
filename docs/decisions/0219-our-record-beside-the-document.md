# 0219 — Our record, beside the document

**Status: built.** The viewer shows the supplier we matched, in two
columns, next to the image.

---

## An email to write to

> One field I forgot was Supplier Email Address.

Oracle's supplier site has `EmailAddress`, and decision 0207 put it
among the attributes **carried and forwarded** rather than acted on —
right about the ERP and wrong about the person.

**Decision 0031 built `return_to_supplier` with no way to reach one.**
An invoice returned to a supplier needs an address to return it to, and
there has never been one.

**Deliberately not the electronic address.** `BT-34` is a Peppol
endpoint under a scheme — machine-routed and unreadable. This is where a
human sends a question.

---

## The panel is a check, not a restatement

> I would like the Seller box to show Supplier Name, VAT ID, electronic
> address and Email Address on a left column and perhaps the Physical
> address in a second column on the right. This enables a user to look
> at the invoice image, and ensure that the corresponding address
> identified matches the information displayed.

**That settles what the panel contains.** An email and a street address
are not in the closed vocabulary and never appear on an invoice's facts
— so this cannot be the seller's own fields. It is **our record of
them**.

Which makes it a **verification of the match** rather than a second copy
of the document. The seller's own fields are still below, unchanged.

### And it matters more since yesterday

Decision 0218 made a supplier with three sites match on a **pay-site
flag** — something that is nowhere on the invoice. All three sites share
one VAT number.

***"Is this the right site"* is exactly what an image can answer and a
VAT number cannot.** So the panel names the site and says it takes
payment, and a person can check the London PO box against what is
printed.

---

## The unmatched case is the one worth explaining

A panel that disappears says nothing. This one says **which of three
things happened**, because they need three different actions:

- **No identifier** — the document names no seller VAT number or
  endpoint, so nothing could be looked up.
- **No match** — nobody on file. *"They may be new, or the supplier list
  may need reloading"*, which is decision 0208's stale mirror in a
  sentence.
- **Ambiguous site** — several sites take payment and none was named.

**And a hold is shown with its reason**, because it changes what happens
next and a person should not discover it at approval.

---

## What is not built

- **Nothing acts on the hold** — it is displayed and no rule reads it.
  Decision 0211's gap, now visible in two places rather than one.
- **No way to choose a site** when the panel says it is ambiguous. It
  explains and offers nothing.
- **The email is not used by `return_to_supplier`**, which is why it was
  added — that wiring is the next step and this is only the field.
- **No supplier is reachable from the panel.** A person who wants to see
  the whole record goes to the Suppliers screen and finds it by eye.
