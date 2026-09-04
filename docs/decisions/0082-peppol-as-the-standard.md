# 0082 — Peppol BIS 3.x is the shape of every document we store

**Status: principle, plus three findings.** Nothing built here. Records
a decision about where document shapes come from, and what adopting it
exposes.

---

## The principle

**When this system stores a business document, its shape comes from the
Peppol BIS 3.x transaction that describes it** — not from what an ERP
happens to export, and not from a shape invented here.

Already followed twice without being stated: invoices from EN 16931 via
Peppol BIS Billing (Document 2), purchase orders from BIS Order Only
(decision 0081). Stating it makes the next one a lookup rather than a
design conversation.

The argument is the same one that made the invoice vocabulary work: a
document addressed the way the standard addresses it is one a customer's
tax adviser, ERP vendor and auditor already understand. A shape invented
here is a shape only this system understands.

---

## What Peppol BIS 3.x actually contains

Twelve transactions, not one. `docs.peppol.eu/poacc/upgrade-3/`:

| | Transaction | Relevance to AP |
| --- | --- | --- |
| T01 | Order | **Built** (0081) |
| T16 | Despatch Advice | **The missing third leg of three-way matching** |
| T19 | Catalogue | Price and item reference |
| T58 | Catalogue Response | — |
| T76 | Order Response | What the seller will actually supply |
| T77 | Punch Out | — |
| T110 | Order Agreement | — |
| T111 | Invoice Response | Telling a supplier an invoice was rejected |
| T114 | Order Change | Revised orders, currently handled by replacement |
| T115 | Order Cancellation | — |
| T116 | Order Response Advanced | — |
| T71 | Message Level Response | Transport-level acknowledgement |

Plus BIS Billing, which is the invoice and the only one grounded in EN
16931.

---

## Finding 1: Despatch Advice is what three-way matching needs

`permissions.ts` has always described `AP.Match` as *"3-way match against
PO/goods receipt"*. The goods receipt is **T16, Despatch Advice** — and
it does not exist here.

So decision 0081 delivered one of the three legs. Two-way matching
(invoice against order) is possible now; three-way is not, and the
permission has been describing a capability with two thirds of its data
missing.

That is worth knowing before matching is designed, because a matcher
built for two documents is not obviously the one you want for three.

---

## Finding 2: only the invoice has Business Terms

Adopting Peppol as *the* standard does **not** mean one naming scheme.

BIS Billing is a CIUS of EN 16931, which is where `BT-112` and its
siblings come from. The other eleven transactions derive from CEN BII
profiles and address everything by **UBL element name** — decision 0081
found this for orders and named columns accordingly.

So the rule is: **EN 16931 Business Terms for invoices, UBL element
names for everything else.** Inventing a parallel numbering for the
others would falsely imply a standard, exactly as `EXPENSE_FIELDS`
avoided (decision 0022).

Worth stating because "use Peppol throughout" could easily be read as
"use BT codes throughout", and that reading is wrong.

---

## Finding 3: detection determines structure, not document type

The gap this principle exposes, and the one with a live consequence.

Decision 0062's cascade answers *"what structure is this"* —
`structured_xml`, `structured_pdfa`, `image`. It does **not** answer
*"what document is this"*, and the XML branch then assumes an invoice:

```ts
} else if (detection.structure === "structured_xml") {
  result = await handleCaptureUblXml(...)   // parseUblInvoice
```

**A valid Peppol Order sent to `/sources/:id/capture` is refused** —
`parseUblInvoice` throws on a non-`<Invoice>` root. Safe rather than
silent, which is the right failure, but wrong under this principle: it
is a conforming document the system cannot route.

### Peppol supplies the discriminator

Every Peppol message carries `cbc:CustomizationID` and `cbc:ProfileID`,
identifying the message type and the business process it belongs to.
Nothing in this codebase reads either.

`urn:fdc:peppol.eu:poacc:trns:order:3` says *this is an Order* without
inspecting a root element name or guessing from a namespace. That is the
standard's own answer to the question detection cannot currently ask.

### What it would change

The cascade gains a step. Today: bytes → structure → handler. With a
document-type step: bytes → structure → **document type** → handler,
where an Order routes to order ingestion and an Invoice to capture.

**Non-trivial**, because ingestion and capture are deliberately
different paths (decision 0081): an order is reference data, an invoice
is work. So the step does not merely select a parser, it selects which
half of the system the document belongs to.

---

## What this decides, and what it does not

**Decides:** where document shapes come from, and that Business Terms
apply to invoices only.

**Does not decide:**

- Whether to read `CustomizationID`, and where — cheap on its own,
  consequential in what it implies about routing.
- Whether Despatch Advice comes before or after matching. Building
  matching for two documents first risks a design that does not extend;
  building T16 first delays anything working.
- Any of the other nine transactions. Most are not AP concerns at all,
  and adopting a standard does not mean implementing all of it.
