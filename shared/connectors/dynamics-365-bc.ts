import type { OutboundField, OutboundMapping } from "./outbound-mapping.js";

/**
 * **Microsoft Dynamics 365 Business Central — decision 0609**, the fourth
 * ERP connector.
 *
 * Creates a draft purchase invoice through Business Central's standard API
 * v2.0, `POST https://api.businesscentral.dynamics.com/v2.0/<tenant>/<environment>/api/v2.0/companies(<id>)/purchaseInvoices`,
 * with its lines in the same request (`purchaseInvoiceLines`, a deep
 * insert) and each line's dimensions (`dimensionSetLines`). Signed in with
 * OAuth 2.0 client credentials from the customer's Microsoft Entra app
 * (`https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token`, scope
 * `https://api.businesscentral.dynamics.com/.default`, filled in). Business
 * Central answers with the invoice; its number is kept as the reference
 * back. The invoice stays a draft for the customer to post.
 *
 * Each distribution is a line of type Account: its G/L account, a
 * quantity of 1 at its net amount, the line's description, and its
 * dimensions: the cost centre as **DEPARTMENT** and the project as
 * **PROJECT** (Business Central's own codes; a customer whose dimensions
 * are named otherwise changes them in the mapping).
 *
 * As for Oracle, SAP and Intacct: **Business Central calculates the VAT**,
 * from its VAT posting setup and each line's tax code (looked up from the
 * VAT category, or the G/L account's own where the list is left empty);
 * `totalAmountIncludingTax` carries the invoice's gross total, which
 * Business Central checks before posting where *Check Doc. Total Amounts*
 * is on. The currency is left blank where it is the company's own, as
 * Business Central wants: **GBP** to begin with, changed in the mapping
 * for a company whose own currency is another.
 *
 * A first version, built from Microsoft's documented API and proved
 * against a simulated Business Central, until a customer's or partner's
 * sandbox has run it.
 */
export const BC_TOKEN_SCOPE = "https://api.businesscentral.dynamics.com/.default";

export const BC_LISTS = {
  taxCodes: "Business Central tax codes",
} as const;

export function dynamics365BcMapping(): OutboundMapping {
  const from = (target: string, source: string, extra: Partial<OutboundField> = {}): OutboundField => ({ target, source, fx: [], ...extra });
  return {
    format: "json",
    invoice: [
      from("vendorNumber", "supplier.erpId", { required: true }),
      from("vendorInvoiceNumber", "invoiceNumber", { required: true, fx: [{ fn: "first_letters", args: { n: 35 } }] }),
      from("invoiceDate", "issueDate", { required: true }),
      from("postingDate", "sentOn"),
      from("dueDate", "dueDate"),
      from("currencyCode", "currency", { fx: [{ fn: "empty_if", args: { value: "GBP" } }] }),
      { target: "pricesIncludeTax", source: null, fixed: false, fx: [] },
      from("totalAmountIncludingTax", "totals.total"),
    ],
    lines: { name: null, fields: [] },
    distributions: {
      name: "purchaseInvoiceLines",
      place: "invoice",
      fields: [
        { target: "lineType", source: null, fixed: "Account", fx: [] },
        from("lineObjectNumber", "distribution.glCode", { required: true }),
        from("description", "line.description", { fx: [{ fn: "first_letters", args: { n: 100 } }] }),
        { target: "quantity", source: null, fixed: 1, fx: [] },
        from("unitCost", "distribution.netAmount", { required: true }),
        from("taxCode", "line.vatCategory", { fx: [{ fn: "look_up", args: { list: BC_LISTS.taxCodes, otherwise: "unless_empty" } }] }),
        from("dimensionSetLines.0.code", "distribution.costCentre", { fx: [{ fn: "present_as", args: { value: "DEPARTMENT" } }] }),
        from("dimensionSetLines.0.valueCode", "distribution.costCentre"),
        from("dimensionSetLines.1.code", "distribution.project", { fx: [{ fn: "present_as", args: { value: "PROJECT" } }] }),
        from("dimensionSetLines.1.valueCode", "distribution.project"),
      ],
    },
    empty: "omit",
  };
}
