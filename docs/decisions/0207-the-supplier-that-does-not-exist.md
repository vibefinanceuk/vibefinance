# 0207 — The supplier that does not exist

**Status: evaluation, no code.** What a vendor record would be, what is
missing, and what of Oracle's model is worth borrowing.

---

## Today there is no supplier at all

A seller exists only as **facts on an invoice**: `BT-27` the name,
`BT-31` the VAT id, `BT-34` the electronic address, `BT-40` the country.
Copied onto `invoice_headers.supplier_vat_id` so duplicate detection can
group by it, and nowhere else.

**There is no supplier table, no site, no terms, no hold, no bank
details and no ERP identifier.**

`party.first_document` has been in the closed vocabulary since decision
0031 — *"true if this is the first document from this party"* — and
**nothing computes it.** A rule could reference it today and it would
never fire. That field is the whole of this record's subject, declared
and unimplemented.

---

## Oracle's definition is the useful part

> **Entity that captures the business relationship between a procurement
> business unit in a buying organization and the supplier.** The site
> captures business terms and conditions as negotiated by the business
> unit with the supplier.

**A site is not an address.** It is the pairing of *their* company with
*our* operating unit, plus what was agreed between those two.

Which is why Oracle's site carries `ProcurementBU`, and why *"the name
is unique within a procurement BU"*. **Two of our operating units can
hold different terms with the same supplier**, and that is normal rather
than exceptional.

**This lands directly on decision 0036's model.** An operating unit is
Oracle's procurement business unit — decision 0194 found that the two
had arrived at the same thing — so a site is `(supplier, operating
unit)`, and the tree is already there.

---

## Eighty attributes, and the ones that matter here

Oracle's supplier site has around eighty. The operator's own filter is
the right one:

> Much of this information is only needed so that we can match an
> incoming invoice to a supplier record that exists in the ERP system
> and pass the information to the ERP for payment. But to the extent
> that the information impacts our process flow — we need to know about
> it.

**Three groups, and only one of them is ours.**

### Affects the process, so we must hold it

| | Why |
| --- | --- |
| `HoldAllInvoicesFlag`, `HoldReason` | An invoice from a held supplier **routes differently**, and a hold nobody can see is a hold nobody applies |
| `HoldUnmatchedInvoices`, `HoldUnvalidatedInvoicesFlag` | Conditional holds, and each is a different rule |
| `PaymentTerms`, `TermsDateBasis` | `BT-9` is the supplier's **claim** about the due date; terms are what was **agreed**, and they can disagree |
| `InvoiceMatchOption` | Two-way against a PO or three-way against a receipt — **this decides which stages an invoice visits** |
| `MatchApprovalLevel`, `AmountTolerances`, `QuantityTolerances` | When a match fails and by how much before it does |
| `InactiveDate` | An invoice from a site closed last year is an exception, not a payable |
| `InvoiceCurrency` | A document in the wrong currency is worth catching at intake |

### Carried and passed through, never interpreted

Bank details, `PayGroup`, `PaymentPriority`, `PayDateBasis`, the tax
reporting flags, freight terms, receipt routing. **We store and forward
these** — they belong to the ERP's payment run, and reimplementing their
meaning would be reimplementing the ERP.

### Not ours at all

Consignment ageing, procurement card flags, sourcing, acknowledgement
requirements, carriers and ship-to exceptions. These describe buying,
and this product starts when an invoice arrives.

---

## Matching, and it is decision 0204 pointed the other way

Decision 0204 built exactly this mechanism for the **buyer**: read the
identifiers off the document, match against configured records, report
which of several reasons applied when it cannot.

**The supplier side is the same code with the fields reversed.**

| Buyer (built) | Supplier (missing) |
| --- | --- |
| `BT-49` buyer electronic address | `BT-34` **seller** electronic address |
| `BT-48` buyer VAT id | `BT-31` **seller** VAT id |
| `BT-10` buyer reference | `BT-13` purchase order reference |

And the same shape of failure: **no identifier**, **no match**, or a
match on a supplier with **several sites** and no way to choose.

**The last one is genuinely harder here.** A supplier with three sites
and an invoice naming none of them is common, where a buyer with several
operating units is a configuration somebody chose.

---

## A new supplier is a real outcome, not a failure

> We also need a mechanism to identify new supplier invoices, and route
> to a team to review and create a new supplier record.

**This is what `party.first_document` was declared for**, and the
mechanism it needs is one this system already has: a **stage** with a
rule that fires on it and an `assign_task` to a review team.

So the missing piece is **not a workflow** — it is the fact that
nothing knows whether a party is new, because nothing records parties at
all.

**And it should probably be `supplier.unknown` rather than
`party.first_document`.** The two are different questions: a supplier
absent from our records is *unknown*, and a known supplier's first
invoice this year is a *first document*. The second is interesting and
the first is what routes to a team.

---

## What the framework is missing

- **A `suppliers` table.** One row per company: name, VAT id,
  electronic address, country, ERP identifier, status.
- **A `supplier_sites` table**, keyed by `(supplier, operating unit)`,
  carrying what was agreed — terms, hold, match option, tolerances,
  currency, an ERP site identifier.
- **Matching at capture**, the mirror of decision 0204.
- **A vocabulary field** for *unknown supplier*, so a rule can route on
  it.
- **Hold as something the process reads**, not just a column.
- **And a screen**, because supplier records are the kind of
  configuration a person maintains daily rather than sets up once.

---

## Deliberately not decided

- **Whether we are the master or a mirror.** If the ERP owns suppliers,
  this is a read-only projection kept in step — and *"create a new
  supplier record"* means raising a request there, not creating one
  here. **That changes almost everything below it**, and it is the first
  question.
- **How sites are chosen** when an invoice names a supplier and not a
  site.
- **Whether terms override `BT-9`** or merely disagree with it visibly.
  Decision 0170's argument suggests the second: a disagreement is
  information, and silently preferring one is not.
- **Whether a hold blocks or routes.** Decision 0143 made a stage
  read-only as a property; a hold could be the same shape, or it could
  be a rule that sends an invoice somewhere else.
