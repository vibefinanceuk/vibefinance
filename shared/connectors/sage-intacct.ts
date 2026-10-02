import type { OutboundField, OutboundMapping } from "./outbound-mapping.js";

/**
 * **Sage Intacct — decision 0607**, the third ERP connector.
 *
 * Creates an AP bill through Sage's REST API (Dan's choice over the XML
 * Web Services API), `POST https://api.intacct.com/ia/api/v1/objects/accounts-payable/bill`,
 * signed in with OAuth 2.0 client credentials for a web services user (the
 * user name, `user@company`, goes with the token request). The address
 * and the token address are the same for every customer, so they come
 * filled in. Intacct answers `{ "ia::result": { key, id, href } }`; the
 * record's key is kept as the reference back.
 *
 * Each distribution is a bill line: its GL account, amount (as text, as
 * Intacct writes them), the line's description as its memo, and its
 * department (the cost centre), project and location dimensions.
 *
 * **Intacct calculates the VAT** (Dan's choice, as for Oracle and SAP):
 * each line names its purchase tax detail, looked up from the VAT category
 * (`S` → `UK Purchase Goods Standard Rate`). A company without tax enabled,
 * a US one say, leaves that list empty and its lines go untaxed; once the
 * list has entries, a category missing from it stops the invoice.
 *
 * A first version, built from Sage's published REST documentation and
 * proved against a simulated Intacct, until a customer's or partner's
 * Intacct company has run it.
 */
export const INTACCT_BILL_URL = "https://api.intacct.com/ia/api/v1/objects/accounts-payable/bill";
export const INTACCT_TOKEN_URL = "https://api.intacct.com/ia/api/v1/oauth2/token";

export const INTACCT_LISTS = {
  locations: "Intacct locations",
  taxDetails: "Intacct purchase tax details",
} as const;

export function sageIntacctMapping(): OutboundMapping {
  const from = (target: string, source: string, extra: Partial<OutboundField> = {}): OutboundField => ({ target, source, fx: [], ...extra });
  const lookUp = (list: string) => ({ fn: "look_up" as const, args: { list, otherwise: "unless_empty" } });
  return {
    format: "json",
    invoice: [
      from("billNumber", "invoiceNumber", { required: true }),
      from("vendor.id", "supplier.erpId", { required: true }),
      from("createdDate", "issueDate", { required: true }),
      from("postingDate", "sentOn"),
      from("dueDate", "dueDate", { required: true }),
      from("currency.txnCurrency", "currency", { required: true }),
      from("referenceNumber", "purchaseOrder"),
      { target: "description", source: null, built: "VibeFinance {id}", fx: [] },
      { target: "isTaxInclusive", source: null, fixed: false, fx: [] },
    ],
    lines: { name: null, fields: [] },
    distributions: {
      name: "lines",
      place: "invoice",
      fields: [
        from("glAccount.id", "distribution.glCode", { required: true }),
        from("txnAmount", "distribution.netAmount", { required: true, fx: [{ fn: "decimal_text", args: { places: 2 } }] }),
        from("memo", "line.description", { fx: [{ fn: "first_letters", args: { n: 1000 } }] }),
        from("dimensions.department.id", "distribution.costCentre"),
        from("dimensions.project.id", "distribution.project"),
        from("dimensions.location.id", "company", { fx: [lookUp(INTACCT_LISTS.locations)] }),
        from("taxEntries.0.purchasingTaxDetail.id", "line.vatCategory", { fx: [lookUp(INTACCT_LISTS.taxDetails)] }),
      ],
    },
    empty: "omit",
  };
}
