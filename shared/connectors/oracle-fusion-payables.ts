import type { OutboundField, OutboundMapping } from "./outbound-mapping.js";

/**
 * **Oracle Fusion Payables — decision 0605**, the first ERP connector
 * (slice 5 of the connector framework).
 *
 * Creates a Payables invoice through Oracle's REST API,
 * `POST /fscmRestApi/resources/11.13.18.05/invoices`, with its lines and
 * each line's distributions, in the shape of Oracle's own documented
 * examples (*Create an Invoice with an Unmatched Line…*): the header by
 * business unit, supplier and supplier site; `invoiceLines`; and in each
 * line `invoiceDistributions`. Oracle answers with the invoice, and its
 * `InvoiceId` is kept as the reference back.
 *
 * Dan's choices, 2 October 2026:
 *
 * - **The account is built from its parts.** Oracle needs each
 *   distribution's full account (`DistributionCombination`, such as
 *   `01-100-7110-0000-000`); VibeFinance holds the company, cost centre
 *   and GL code apart. The pattern below is a starting point each
 *   customer adjusts to their chart of accounts, its company segment
 *   looked up in a list.
 * - **Oracle calculates VAT, and is checked.** Its invoice lines cannot
 *   carry tax: lines go at their net amounts with a tax classification
 *   (from the VAT category, through a list); `InvoiceAmount` is the gross
 *   total, and `ControlAmount` the VAT on the invoice, so Oracle holds the
 *   invoice if its own calculation disagrees.
 * - **A first version.** There was no Oracle environment to try it
 *   against: it is built from Oracle's documented API and examples and
 *   proved against a simulated Oracle, and says so until a customer's or
 *   partner's test pod has run it.
 *
 * The look-up lists it needs, by name; each customer fills in their own.
 */
export const ORACLE_LISTS = {
  businessUnits: "Oracle business units",
  companySegments: "Oracle company segments",
  taxClassifications: "Oracle tax classifications",
} as const;

export function oracleFusionPayablesMapping(): OutboundMapping {
  const from = (target: string, source: string, extra: Partial<OutboundField> = {}): OutboundField => ({ target, source, fx: [], ...extra });
  const fixed = (target: string, value: string): OutboundField => ({ target, source: null, fixed: value, fx: [] });
  const lookUp = (list: string) => [{ fn: "look_up" as const, args: { list, otherwise: "refuse" } }];
  return {
    format: "json",
    invoice: [
      from("InvoiceNumber", "invoiceNumber", { required: true, fx: [{ fn: "first_letters", args: { n: 50 } }] }),
      from("InvoiceCurrency", "currency", { required: true }),
      from("InvoiceAmount", "totals.total", { required: true }),
      from("InvoiceDate", "issueDate", { required: true }),
      from("BusinessUnit", "company", { required: true, fx: lookUp(ORACLE_LISTS.businessUnits) }),
      from("Supplier", "supplier.name", { required: true }),
      from("SupplierSite", "supplier.site", { required: true }),
      { target: "Description", source: null, built: "VibeFinance {id}", fx: [] },
      from("ControlAmount", "totals.vat"),
    ],
    lines: {
      name: "invoiceLines",
      fields: [
        from("LineNumber", "line.lineNumber", { required: true }),
        fixed("LineType", "Item"),
        from("LineAmount", "line.netAmount", { required: true }),
        from("Description", "line.description", { fx: [{ fn: "first_letters", args: { n: 240 } }] }),
        from("Quantity", "line.quantity"),
        from("TaxClassification", "line.vatCategory", { fx: lookUp(ORACLE_LISTS.taxClassifications) }),
      ],
    },
    distributions: {
      name: "invoiceDistributions",
      place: "line",
      fields: [
        from("DistributionLineNumber", "distribution.numberInLine", { required: true }),
        fixed("DistributionLineType", "Item"),
        from("DistributionAmount", "distribution.netAmount", { required: true }),
        {
          target: "DistributionCombination",
          source: null,
          built: `{company|${ORACLE_LISTS.companySegments}}-{distribution.costCentre}-{distribution.glCode}-0000-000`,
          fx: [],
          required: true,
        },
      ],
    },
    // Oracle defaults what it is not sent: an empty value is left out.
    empty: "omit",
  };
}
