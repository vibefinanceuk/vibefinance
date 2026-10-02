# 0605: Oracle Fusion Payables, the first ERP connector

**Status: built and tested locally, not yet pushed or deployed.** It
touches `shared`, `vf-app`, `vf-ui` and `vf-licence`, and needs
**`vf-licence` migration `0249`** (strings). Deploy vf-licence, vf-app and
vf-ui. No `vf-app` migration.

## What was asked

Slice 5 of the connector framework (`claude/connector-framework-design.md`):
the first real ERP connector, its choice left until now. Dan, 2 October:
*"Oracle Fusion Payables please"*. Asked three questions, he chose:

1. **The account built from its parts**, with a pattern each customer
   adjusts to their chart of accounts;
2. **Oracle calculates VAT, and is checked**;
3. there is **no Oracle test environment yet**: build it from Oracle's
   documented API, prove it against a simulated Oracle, and mark it a
   first version.

## What was decided

### The connector

`oracle-fusion-payables` moves from Planned to **Available, a first
version**. It is an HTTPS out connector (0589) carrying its own outbound
mapping (0591), as partner connectors do (0601):

- `POST` to the customer's
  `https://<pod>.oraclecloud.com/fscmRestApi/resources/11.13.18.05/invoices`,
  the method and its own layout fixed;
- signs in with a Fusion user's **password**, or **OAuth 2.0 client
  credentials** (Oracle Identity Cloud, with its scope);
- keeps Oracle's **`InvoiceId`** from the reply as the reference back.

### The layout

In the shape of Oracle's own documented examples (*Create an Invoice with
an Unmatched Line…*): the header, `invoiceLines`, and in each line
`invoiceDistributions`.

| Oracle | From | |
|---|---|---|
| `InvoiceNumber` | the invoice number, its first 50 characters | required |
| `InvoiceCurrency`, `InvoiceDate` | currency, issue date | required |
| `InvoiceAmount` | **the gross total** | required |
| `BusinessUnit` | the company, looked up in **Oracle business units** | required |
| `Supplier`, `SupplierSite` | the supplier's name, and its ERP site | required |
| `Description` | built: `VibeFinance <invoice id>` | |
| `ControlAmount` | **the VAT on the invoice** | |
| line `LineNumber`, `LineAmount` | line number, **net** amount | required |
| line `LineType` | `Item` | |
| line `Description`, `Quantity` | as on the line | |
| line `TaxClassification` | the VAT category, looked up in **Oracle tax classifications** | |
| distribution `DistributionLineNumber` | 1, 2, … within its line | required |
| distribution `DistributionLineType` | `Item` | |
| distribution `DistributionAmount` | its net amount | required |
| distribution `DistributionCombination` | **built**: `{company\|Oracle company segments}-{costCentre}-{glCode}-0000-000` | required |

**VAT.** Oracle's invoice lines cannot carry tax: Oracle calculates it
when the invoice is validated, from each line's tax classification. The
lines go net and the invoice gross; `ControlAmount` is the VAT the
supplier charged, so Oracle holds the invoice if its own calculation
disagrees, rather than paying a different amount silently.

Not sent: payment terms, pay group and the like, which Oracle defaults
from the supplier site; a purchase order match (unmatched invoices only,
for now); an invoice source or group. A customer adds any of them in the
mapping.

### Fields built from parts (`shared`)

An outbound mapping field can now be **built from parts**, a pattern such
as `{company|Oracle company segments}-{distribution.costCentre}-{distribution.glCode}-0000-000`:

- each `{source}` is that field of the invoice; `{source|list}` is it
  looked up in that look-up list (by id in a Destination's mapping, by
  name in a connector's definition, renamed between them as functions'
  lists are, 0595);
- if any part is empty, so is the field (so a required one says so);
- a value not in a list stops the invoice, naming the list;
- then the field's functions apply, as to any other.

It suits any target that wants one value from several: SAP's coding
block, a reference made of two numbers. A new source,
`distribution.numberInLine`, numbers each line's distributions from 1, as
Oracle does.

The **outbound mapping editor** shows a built field's pattern with its
lists by name, takes one typed the same way (refusing a list there is
none of), and keeps it apart from a single source or a fixed value.

### Adding it

As any connector carrying a mapping (0601): **Add to my routes** makes the
Destination paused, with the settings, the **mapping live**, and the
three look-up lists made empty, *"Needed by Oracle Fusion Payables"*. The
Destination's panel lists them, marked empty until filled in. **Try**
says, in words, each invoice's business unit, tax classification or
company segment not in its list before anything is sent. The customer
adjusts the account pattern to their chart of accounts in the mapping.

### A first version

The Route library card and the Destination's panel show **First version**:
*"Built from the vendor's documented API and proved against a simulated
system, not yet a live one. Try it on a test environment before
production."* It comes off when a customer's or partner's Oracle test
pod has run it.

## Not built

- **Matching to a purchase order** (`PurchaseOrderNumber` and its line on
  each invoice line): unmatched invoices first.
- **Bulk import** through Oracle's Payables interface and import process
  (FBDI or `payablesInterfaceInvoices`), for high volumes.
- **Upgrading a standard connector's mapping**: a later version of a
  standard connector applies what it fixes (0589); its mapping does not
  yet follow, as a partner's does (0601).
- Reading Oracle's validation and payment status back.

## Verification

- **`shared`**, `oracle-fusion-payables.test.ts`, 6 tests: a built field's
  parts, look-ups and emptiness, its problems in words; patterns refused
  (unknown part, below its level, no part, an open brace, beside a
  source); lists renamed between names and ids, and a partner may submit
  one; Oracle available as a first version with its settings; an invoice
  laid out exactly as Oracle's examples, net lines, gross total, VAT as
  the control amount, each account built; what stops one, in words.
  Full run 422, of which 418 pass and 1 is skipped (the three known
  failures).
- **`vf-app`**, `oracle-connector.test.ts`, 5 tests: in the library as a
  first version; added with settings, mapping live and three empty lists;
  Try names what the lists lack; once filled, posted to a simulated Oracle
  signed in with the Fusion user's password, in exactly Oracle's shape,
  and the `InvoiceId` kept; Oracle's plain-text refusal kept in its own
  words; the account pattern changed by the customer, and an unknown list
  refused. `connector-library.test.ts`: SAP is now the planned example.
- **`vf-ui`**, `routes.test.ts`, 2 new tests: a built field shown and
  typed with lists by name and stored by id, an unknown list refused; the
  First version label. Both fail against the interface before this
  change.
- **Migrations** replay: `vf-licence` 249.
- **Screenshot** of the Route library with Oracle available.

Oracle's documentation: *Create an invoice*,
`docs.oracle.com/en/cloud/saas/financials/25d/farfa/op-invoices-post.html`,
and its examples.
