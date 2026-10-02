import type { OutboundField, OutboundMapping } from "./outbound-mapping.js";

/**
 * **SAP S/4HANA Cloud — decision 0606**, the second ERP connector.
 *
 * Creates a supplier invoice with G/L account lines through SAP's OData V2
 * service `API_SUPPLIERINVOICE_PROCESS_SRV` (communication scenario
 * `SAP_COM_0057`), `POST …/A_SupplierInvoice` with the G/L account items
 * in `to_SupplierInvoiceItemGLAcct`, one for each distribution: unmatched
 * invoices, coded to G/L account and cost centre.
 *
 * What SAP's OData services want, and VibeFinance now does for any target
 * like them:
 *
 * - **a CSRF token first**: a `GET` with `x-csrf-token: Fetch`, then the
 *   `POST` with the token and the session's cookies (the Destination's
 *   *Fetch a CSRF token first* setting);
 * - **dates** as `/Date(milliseconds)/` (`odata_date`);
 * - **amounts as text** with two decimals (`decimal_text`);
 * - **a posting date**: the day it is sent (`sentOn`).
 *
 * As with Oracle (0605): **SAP calculates the VAT** from each item's tax
 * code (`TaxIsCalculatedAutomatically`) and balances it against the
 * invoice's gross amount, so a disagreement stops the posting rather than
 * paying a different amount; and it is **a first version**, built from
 * SAP's documented API and proved against a simulated SAP, until a
 * customer's or partner's S/4HANA test system has run it. The supplier is
 * SAP's own number, the supplier's ERP id in VibeFinance. SAP's
 * reply carries the new document's number, kept as the reference back.
 */
export const SAP_LISTS = {
  companyCodes: "SAP company codes",
  taxCodes: "SAP tax codes",
} as const;

export function sapS4hanaCloudMapping(): OutboundMapping {
  const from = (target: string, source: string, extra: Partial<OutboundField> = {}): OutboundField => ({ target, source, fx: [], ...extra });
  const fixed = (target: string, value: string | boolean): OutboundField => ({ target, source: null, fixed: value, fx: [] });
  const lookUp = (list: string) => ({ fn: "look_up" as const, args: { list, otherwise: "refuse" } });
  const date = { fn: "odata_date" as const, args: {} };
  const amount = { fn: "decimal_text" as const, args: { places: 2 } };
  return {
    format: "json",
    invoice: [
      from("CompanyCode", "company", { required: true, fx: [lookUp(SAP_LISTS.companyCodes)] }),
      from("DocumentDate", "issueDate", { required: true, fx: [date] }),
      from("PostingDate", "sentOn", { required: true, fx: [date] }),
      from("InvoicingParty", "supplier.erpId", { required: true }),
      from("SupplierInvoiceIDByInvcgParty", "invoiceNumber", { required: true, fx: [{ fn: "first_letters", args: { n: 16 } }] }),
      from("DocumentCurrency", "currency", { required: true }),
      from("InvoiceGrossAmount", "totals.total", { required: true, fx: [amount] }),
      fixed("TaxIsCalculatedAutomatically", true),
      from("DueCalculationBaseDate", "issueDate", { fx: [date] }),
      { target: "DocumentHeaderText", source: null, built: "VibeFinance {id}", fx: [{ fn: "first_letters", args: { n: 25 } }] },
    ],
    lines: { name: null, fields: [] },
    distributions: {
      name: "to_SupplierInvoiceItemGLAcct",
      place: "invoice",
      fields: [
        from("SupplierInvoiceItem", "distribution.sequence", { required: true, fx: [{ fn: "pad", args: { digits: 4 } }] }),
        from("CompanyCode", "company", { required: true, fx: [lookUp(SAP_LISTS.companyCodes)] }),
        from("GLAccount", "distribution.glCode", { required: true }),
        from("CostCenter", "distribution.costCentre"),
        from("WBSElement", "distribution.project"),
        from("DocumentCurrency", "currency", { required: true }),
        from("SupplierInvoiceItemAmount", "distribution.netAmount", { required: true, fx: [amount] }),
        from("TaxCode", "line.vatCategory", { required: true, fx: [lookUp(SAP_LISTS.taxCodes)] }),
        fixed("DebitCreditCode", "S"),
        from("SupplierInvoiceItemText", "line.description", { fx: [{ fn: "first_letters", args: { n: 50 } }] }),
      ],
    },
    empty: "omit",
  };
}
