# 0115 — Seller and buyer, and one status panel

**Status: built.** A layout change, driven by looking at the screen.

---

## What was wrong with the space

The operator's observation:

> The status and validation boxes take up a lot of real-estate. Instead
> have Buyer and Seller boxes, with related Buyer and Seller fields.
> The Status, Stage, Waiting and Owner can be merged into one box on the
> same row.

**Four panels for four short values.** A card each for *Not yet keyed*,
*Validation*, *2 days* and *Available* — a row of real estate to say
very little, while the seller and buyer had nowhere to appear at all.

---

## One status panel, because it is one sentence

Status, stage, waiting and owner are **one statement about where this
document is**. Reading them as four separate cards makes that harder
rather than easier, and the separation implied an importance none of
them individually has.

They now share a panel, in a row, with the same values.

---

## The parties get the space

BG-4 collects the seller's terms and BG-7 the buyer's, and until
decision 0112 the seller had no name at all. Now that both sides are
read from the document, they deserve somewhere to be read.

**Party fields are removed from the general header panel**, or they
would appear twice — once under their own heading and once among the
amounts. A panel with nothing in it is not rendered at all: an empty
card says *"there should be something here"* and there never will be.

---

## Both sides treated alike

The defaults had the **seller's** VAT identifier editable and the
**buyer's** hidden. Nobody chose that; it fell out of listing BT-31 in
decision 0114's defaults and not BT-48.

Both are now `read`, along with both countries and both electronic
addresses. `read` rather than `edit` because these come from the
document, and somebody keying an unreadable one is far more likely to
be correcting an amount than a counterparty's country.

A test asserts the two countries have the *same* visibility, which is
the property that was quietly wrong.

---

## What is not built

- **No party grouping in the vocabulary.** The seller and buyer field
  lists are in the viewer. BG-4 and BG-7 are real business groups and
  recording membership in `shared` — as `INVOICE_LINE_FIELDS` does for
  BG-25 — would be the consistent thing. **Left as it is for now, and
  named here** so it is a known shortcut rather than an oversight.
- **Postal addresses.** Only the country codes, because the address
  lines are not in the vocabulary at all (decision 0112 lists them as
  outstanding).
