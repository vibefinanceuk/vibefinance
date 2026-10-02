# 0606: SAP S/4HANA Cloud, the second ERP connector

**Status: built and tested locally, not yet pushed or deployed.** It
touches `shared`, `vf-app`, `vf-ui` and `vf-licence`, and needs
**`vf-licence` migration `0250`** (strings). Deploy vf-licence, vf-app and
vf-ui. No `vf-app` migration.

## What was asked

Dan, 2 October, once Oracle Fusion Payables (0605) was live: *"great -
lets look at SAP S/4HANA next"*. Built on the choices he made for Oracle:
the target calculates VAT and is checked against the invoice; built from
the vendor's documented API and proved against a simulated system; a
first version until a real test system has run it.

## What was decided

### The connector

`sap-s4hana-cloud` moves from Planned to **Available, a first version**.
It creates a supplier invoice with G/L account lines through SAP's OData V2
service `API_SUPPLIERINVOICE_PROCESS_SRV` (communication scenario
`SAP_COM_0057`):

- `POST https://<tenant>-api.s4hana.cloud.sap/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV/A_SupplierInvoice`,
  the method and its own layout fixed;
- signs in as a **communication user** (password), or with **OAuth 2.0
  client credentials**;
- **fetches a CSRF token first** (below);
- keeps SAP's document number, `d.SupplierInvoice`, as the reference
  back.

Unmatched invoices, coded to G/L account and cost centre: a **G/L account
item for each distribution**, in `to_SupplierInvoiceItemGLAcct` on the
invoice.

| SAP | From | |
|---|---|---|
| `CompanyCode` | the company, looked up in **SAP company codes** | required, header and items |
| `DocumentDate` | the issue date, as `/Date(ms)/` | required |
| `PostingDate` | **the day it is sent**, as `/Date(ms)/` | required |
| `InvoicingParty` | the supplier's ERP id, SAP's supplier number | required |
| `SupplierInvoiceIDByInvcgParty` | the invoice number, its first 16 characters | required |
| `DocumentCurrency` | the currency | required, header and items |
| `InvoiceGrossAmount` | **the gross total**, as text with two decimals | required |
| `TaxIsCalculatedAutomatically` | `true` | |
| `DueCalculationBaseDate` | the issue date | |
| `DocumentHeaderText` | built: `VibeFinance <invoice id>`, 25 characters | |
| item `SupplierInvoiceItem` | 0001, 0002, … | required |
| item `GLAccount`, `CostCenter`, `WBSElement` | the distribution's GL code, cost centre and project | GL required |
| item `SupplierInvoiceItemAmount` | its net amount, as text | required |
| item `TaxCode` | the line's VAT category, looked up in **SAP tax codes** | required |
| item `DebitCreditCode` | `S` | |
| item `SupplierInvoiceItemText` | the line's description, 50 characters | |

**VAT.** SAP calculates the tax from each item's tax code and balances it
against the gross amount; a disagreement stops the posting (SAP's
*"Balance not zero"*), and its words are kept, rather than an invoice
posted at a different amount.

### What SAP's OData services need, for any target like them

- **A CSRF token first.** A new Destination setting, *Fetch a CSRF token
  first*: before each attempt, a `GET` of the service the address belongs
  to (its last segment taken off), signed in, with `x-csrf-token: Fetch`;
  the token and the session's cookies go with the `POST`. A refusal to
  give one says so, with the HTTP status, and is retried as any failure
  to reach the target. The preview shows both as fetched first, never
  their values. A partner's connector may carry it too.
- **Three mapping functions:** `odata_date` (an ISO date as
  `/Date(milliseconds)/`), `decimal_text` (a number as text with fixed
  decimals, `357.00`), `pad` (a whole number padded with zeros, `0001`).
- **A new source, `sentOn`:** the day the invoice is laid out to be sent,
  for a posting date. It is not in the standard layout.
- **A fixed value may be `true` or `false`**, as JSON wants it.

### Adding it

As Oracle: **Add to my routes** makes the Destination paused, with the
settings (CSRF on), the mapping live, and two look-up lists made empty,
**SAP company codes** and **SAP tax codes**. **Try** says what they still
need, and names an invoice whose supplier has no SAP number.

## Not built

- **Matching to a purchase order** (`to_SuplrInvcItemPurOrdRef`).
- **Parking** rather than posting.
- **Credit memos** (`H` items, or SAP's credit memo indicator).
- **SAP S/4HANA on premise**, which has the same service behind the
  customer's own gateway: it may work with the address changed, untried.
- Upgrading a standard connector's mapping, as for Oracle (0605).

## Verification

- **`shared`**, `sap-s4hana-cloud.test.ts`, 4 tests: the three functions;
  SAP available as a first version, CSRF on, its lists; an invoice laid
  out as a supplier invoice with a G/L item per distribution, OData dates,
  text amounts, SAP calculating the tax; what stops one, in words. Full
  run 426, of which 422 pass and 1 is skipped (the three known failures).
- **`vf-app`**, `sap-connector.test.ts`, 5 tests, against a simulated SAP
  Gateway that gives a token and cookies only to a signed-in fetch and
  refuses a `POST` without both: the setting and where the token is
  fetched; added with CSRF on, mapping live, two lists; the token fetched,
  then the invoice posted exactly as SAP wants it and the document number
  kept; a token refused, and SAP's *"Balance not zero"* kept in its words;
  Try naming the lists and the missing supplier number.
  `connector-library.test.ts`: Sage Intacct is now the planned example.
- **`vf-ui`**, `routes.test.ts`, 1 new test: the CSRF setting shown and
  saved, and cleared. It fails against the interface before this change.
  Browser 1454, of which 1453 pass (the known `typography.test.ts` 10px
  gap); worker 111 of 111.
- **`vf-licence`** 357 of 357. **Migrations** replay: `vf-licence` 250.

SAP's documentation: *Supplier Invoice (OData V2)*, SAP Help Portal and
`api.sap.com/api/API_SUPPLIERINVOICE_PROCESS_SRV`.
