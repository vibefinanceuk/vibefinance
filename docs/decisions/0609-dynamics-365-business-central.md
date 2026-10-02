# 0609: Microsoft Dynamics 365 Business Central, the fourth ERP connector

**Status: built and tested locally, not yet pushed or deployed.** It
touches `shared`, `vf-app` and `vf-licence`, and needs **`vf-licence`
migration `0253`** (strings). Deploy vf-licence and vf-app. `vf-ui` is
unchanged.

## What was asked

Dan, 2 October 2026: *"Yes, please can you go ahead with MS Business
Central"*, the last of the planned ERP connectors. Built on his choices
for Oracle, SAP and Intacct (0605–0607): the ERP calculates VAT and is
checked against the invoice where it can be; built from the vendor's
documentation and proved against a simulated system; **a first version**
until a real one has run it.

## What was decided

### The connector

`dynamics-365-bc` moves from Planned to **Available, a first version**. It
creates a **draft purchase invoice** through Business Central's standard
API v2.0, the customer's own address:

`POST https://api.businesscentral.dynamics.com/v2.0/<tenant>/<environment>/api/v2.0/companies(<company id>)/purchaseInvoices`

- its lines go **in the same request** (`purchaseInvoiceLines`, Business
  Central's deep insert), each with its dimensions (`dimensionSetLines`);
- signs in with **OAuth 2.0 client credentials** from the customer's
  Microsoft Entra app, `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token`,
  with Business Central's scope, `https://api.businesscentral.dynamics.com/.default`,
  **filled in**;
- keeps the invoice's **number** as the reference back; the invoice
  stays a draft for the customer to post.

| Business Central | From | |
|---|---|---|
| `vendorNumber` | the supplier's ERP id | required |
| `vendorInvoiceNumber` | the invoice number, 35 characters | required |
| `invoiceDate` | the issue date | required |
| `postingDate` | the day it is sent | |
| `dueDate` | the due date | |
| `currencyCode` | the currency, **left blank where it is the company's own** | |
| `pricesIncludeTax` | `false` | |
| `totalAmountIncludingTax` | the gross total | |
| line `lineType` | `Account` | |
| line `lineObjectNumber` | the distribution's G/L account | required |
| line `description` | the line's description, 100 characters | |
| line `quantity`, `unitCost` | 1, at the distribution's net amount | unit cost required |
| line `taxCode` | the VAT category, looked up in **Business Central tax codes** | |
| line `dimensionSetLines` | **DEPARTMENT** = the cost centre, **PROJECT** = the project | |

**VAT.** Business Central calculates it from its VAT posting setup and
each line's tax code; with the tax codes list left empty, each G/L
account's own applies. The gross total goes as `totalAmountIncludingTax`,
which Business Central checks before posting where *Check Doc. Total
Amounts* is on in Purchases & Payables Setup.

**The company's own currency** is left blank, as Business Central wants:
**GBP** to begin with (`empty_if GBP`), changed in the mapping by a
company whose own currency is another. **Dimension codes** are Business
Central's own, DEPARTMENT and PROJECT; a company with others names them in
the mapping.

### What it needed, for any target like it

- **`present_as`**: where there is a value, a fixed text in its place
  (a dimension's code beside its value); where there is none, nothing.
- **`empty_if`**: a value that is exactly this text left empty (the
  company's own currency).
- **A place in a list left empty is dropped**, so a line with a project
  but no cost centre sends one dimension, not an empty one first; a list
  left with nothing goes.
- **A connector may fill in the OAuth scope.**

## Not built

- **Matching to a purchase order**, or lines of type Item.
- **Posting** the draft: Business Central's `Microsoft.NAV.post` action,
  once a customer wants it.
- **Business Central on premise**, which has the same API behind the
  customer's own server: it may work with the address changed, untried.
- Attaching the invoice's PDF to the draft.

## Verification

- **`shared`**, `dynamics-365-bc.test.ts`, 4 tests: the two functions and
  an empty place dropped; available as a first version with its scope; an
  invoice laid out as a draft purchase invoice with an Account line per
  distribution and its dimensions, GBP left blank and EUR sent, the tax
  codes list left empty; what stops one, in words. Full run 436, of which
  432 pass and 1 is skipped (the three known failures).
- **`vf-app`**, `bc-connector.test.ts`, 3 tests, against a simulated
  Entra ID and Business Central: added with its scope filled in and its
  list made; signed in with the scope, the invoice posted with its lines
  and dimensions in one request and its number kept; Business Central's
  refusal kept in its own words. `connector-library.test.ts`: the SFTP
  file drop is now the planned example.
- **`vf-licence`** 358 of 358. **`vf-ui`** browser 1455, of which 1454
  pass (the known `typography.test.ts` 10px gap). **Migrations** replay:
  `vf-licence` 253.

Microsoft's documentation: *Create purchaseInvoices* and the
*purchaseInvoiceLine* resource, Business Central API v2.0
(`learn.microsoft.com/dynamics365/business-central/dev-itpro/api-reference/v2.0/`).
