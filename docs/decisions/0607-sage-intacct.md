# 0607: Sage Intacct, the third ERP connector

**Status: built and tested locally, not yet pushed or deployed.** It
touches `shared`, `vf-app`, `vf-ui` and `vf-licence`, and needs
**`vf-licence` migration `0251`** (strings). Deploy vf-licence, vf-app and
vf-ui. No `vf-app` migration.

## What was asked

Dan, 2 October, after SAP S/4HANA Cloud (0606): *"Lets go for Sage
Intacct"*. Asked two questions, he chose:

1. **Sage's REST API**, over the long-established XML Web Services API
   (which would have needed XML output and a Sage Sender ID with the
   company's login inside every request);
2. **Intacct calculates the VAT**, as Oracle and SAP do.

As before: built from the vendor's published documentation, proved
against a simulated Intacct, **a first version** until a real Intacct
company has run it.

## What was decided

### The connector

`sage-intacct` moves from Planned to **Available, a first version**:

- `POST https://api.intacct.com/ia/api/v1/objects/accounts-payable/bill`,
  **filled in**: the address is the same for every customer;
- signs in with **OAuth 2.0 client credentials** for a web services user:
  the token address (`…/oauth2/token`) is filled in; the customer gives
  the client id and secret of their app, and the user name
  (`user@company`), which goes with the token request;
- keeps the record's key, `ia::result.key`, as the reference back.

An AP bill with **a line for each distribution**:

| Intacct | From | |
|---|---|---|
| `billNumber` | the invoice number | required |
| `vendor.id` | the supplier's ERP id, Intacct's vendor id | required |
| `createdDate`, `dueDate` | issue and due dates | required |
| `postingDate` | the day it is sent | |
| `currency.txnCurrency` | the currency | required |
| `referenceNumber` | the purchase order number | |
| `description` | built: `VibeFinance <invoice id>` | |
| `isTaxInclusive` | `false` | |
| line `glAccount.id` | the distribution's GL code | required |
| line `txnAmount` | its net amount, as text | required |
| line `memo` | the line's description | |
| line `dimensions.department.id`, `.project.id` | the cost centre and project | |
| line `dimensions.location.id` | the company, looked up in **Intacct locations** | |
| line `taxEntries[0].purchasingTaxDetail.id` | the VAT category, looked up in **Intacct purchase tax details** | |

**VAT.** Each line names its purchase tax detail (`S` → `UK Purchase
Goods Standard Rate`) and Intacct's tax solution calculates the tax. **A
company without tax**, a US one say, leaves that list empty, and its lines
go untaxed; once the list has entries, a category missing from it stops
the invoice. The location list works the same way, for a company that
does not use locations.

### What it needed, for any target like it

- **A place in a list in a target name:** `taxEntries.0.purchasingTaxDetail.id`
  lays out `"taxEntries": [{ "purchasingTaxDetail": { "id": … } }]`. A
  place may not come first or last. A name may hold colons, as
  `ia::result`.
- **A look-up for a list a customer may not use:** `look_up` gains
  `otherwise: unless_empty`: as *refuse*, except that a list with nothing
  in it gives an empty value.
- **A user name with OAuth**, sent with the token request where set.
- **A connector may fill in the address and token address**, where every
  customer shares them. A partner's connector still never carries an
  address.
- **A reference read through a list of one**: `$.ia::result.key` reads a
  record, or the first of a list, as Intacct's replies vary.

## Not built

- **Matching to a purchase order** (Intacct purchasing documents).
- **Vendor payment terms and 1099s**: Intacct defaults them from the
  vendor.
- **The XML Web Services API**, for companies whose integrations already
  use it.
- **Supplying the invoice's own VAT** (UK, Australia and South Africa
  only): the alternative Dan did not choose.

## Verification

- **`shared`**, `sage-intacct.test.ts`, 6 tests: a target with a place in
  a list, and places first or last refused; `unless_empty`; Intacct
  available as a first version with its addresses filled in; an invoice
  laid out as a bill, a line per distribution with its dimensions and tax
  detail; a company with empty lists sends untaxed lines without a
  location, and what stops an invoice in words; a partner's connector
  naming an address refused. `lookup.test.ts` updated for the third
  `otherwise`. Full run 432, of which 428 pass and 1 is skipped (the three
  known failures).
- **`vf-app`**, `intacct-connector.test.ts`, 5 tests, against a simulated
  Intacct that gives a token only for the web services user's client
  credentials: the user name kept and references under `ia::result` read;
  added with Intacct's addresses filled in and two lists made; signed in,
  the bill posted exactly as laid out and the key kept; untaxed lines for
  empty lists, and Intacct's refusal kept in its words; Try naming a
  missing tax category. `connector-library.test.ts`: Business Central is
  now the planned example.
- **`vf-ui`**, `routes.test.ts`, 1 new test: the user name asked for with
  OAuth, and saved. It fails against the interface before this change.
  Browser 1455, of which 1454 pass (the known `typography.test.ts` 10px
  gap); worker 111 of 111.
- **`vf-licence`** 357 of 357. **Migrations** replay: `vf-licence` 251.

Sage's documentation: the Sage Intacct REST API, *Bills*
(`developer.sage.com/intacct/docs/openapi/ap/accounts-payable.bill/`), and
the XML API's *Bills* for its tax entries
(`developer.intacct.com/api/accounts-payable/bills/`).
