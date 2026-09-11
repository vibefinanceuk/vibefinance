# 0218 — Where orders go, and where payment goes

**Status: built.** A site says what it is for, and an invoice goes to
the pay site.

---

## The operator's own example

> A supplier might have 3 sites in the UK, 2 procurement sites and 1
> payment site. Effectively where orders are sent, versus where payment
> is sent.

These are Oracle's `PurchasingPurposeFlag` and `PayPurposeFlag`, and
**decision 0207 put them among the attributes describing buying rather
than paying** — which was right about the first and wrong about the
second.

---

## Which changes matching, not just display

**An invoice arrives at a pay site.**

So where several sites share a VAT number and one of them takes payment,
**that is not a disambiguation guess** — it is what the flag means. A
procurement site was never going to be the answer.

Decision 0209 gave up with `ambiguous_site` in that case, and decision
0207 had predicted it would be the common one. **It should now be
rare**: what is left is a supplier with two sites that both take
payment, where picking one would still attach an invoice to terms nobody
agreed for it.

**Where no site declares a purpose** — every row loaded before this —
the whole set is considered and the answer is what it was.

---

## Two flags, because the operator said why

> Two check boxes needed as a site could be both a payment site and a
> procurement site.

An enum of `pay | procurement | both` says the same thing and **makes
*both* look like a third kind of place** rather than a site doing two
jobs. The example file has one of each, including a site that does both.

---

## And the address, which is for a person

Decision 0208 held only `country`, because reverse charge behaves
differently and a street affects nothing the process does.

**That is still true of matching.** A supplier's invoice often shows
their head office whichever site raised it, so matching on an address
would be confidently wrong sometimes.

**It is not true of a person** resolving which site an invoice belongs
to. *"Felixstowe or Dublin"* is the question they are actually
answering, and they cannot answer it from a VAT number that is the same
on both.

---

## A label that hid the argument

The column read **Supplier number**. It now reads **ERP identifier**.

*Supplier number* sounds like ours. **Decision 0209's whole argument is
that it is theirs** — what a payment instruction must carry, and without
which an invoice cannot be paid however well we recognise the name on
it.

**Not editable**, deliberately. A person changing it here could point
our record at a different supplier than the ERP has, silently, with
invoices already attached. **Filling one in on a *discovered* supplier
is a different thing** — that row has never had one — and belongs with
the document-discovery work rather than here.

---

## What is not built

- **No purpose is set on any real row**, since the live load predates
  these columns. Re-loading the file sets them.
- **Nothing uses `is_procurement_site`**, which is carried for the day
  purchase-order matching needs it.
- **`ambiguous_site` still routes nowhere.** It is recorded on the
  invoice and no rule reads it, so a supplier with two pay sites is an
  invoice with no supplier and no explanation on screen.
