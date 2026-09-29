/**
 * Which e-invoice format a document is — decision 0560.
 *
 * Two questions, answered separately because they are separate: the
 * **syntax** (how the XML is written: UBL or CII) and the
 * **specification** the document says it follows (BT-24, the
 * specification identifier). XRechnung can be either syntax; Factur-X
 * and ZUGFeRD are always CII inside a PDF; Peppol BIS is always UBL.
 *
 * **Recognised from what the document declares, never from who sent
 * it.** A supplier who says XRechnung and sends something else is
 * caught by the checks, not excused by the label.
 *
 * The list is closed, like the rule vocabulary: each code has words in
 * `vf-licence`, and an unfamiliar BT-24 is `ubl_other` / `cii_other`
 * rather than a new code nobody can name.
 */

export type InvoiceSyntax = "ubl" | "cii";

export const INVOICE_FORMATS = [
  "peppol_bis_3",
  "xrechnung",
  "factur_x_extended",
  "factur_x_basic",
  "factur_x_basic_wl",
  "factur_x_minimum",
  "en16931",
  "ubl_other",
  "cii_other",
] as const;
export type InvoiceFormat = (typeof INVOICE_FORMATS)[number];

/**
 * Factur-X MINIMUM and BASIC WL carry no invoice lines and are not
 * EN 16931 invoices — the Factur-X specification says so of itself.
 * Checking them against EN 16931 would fail every one on BR-16 and say
 * nothing useful; they are recognised and left unchecked.
 */
export const BELOW_EN16931: ReadonlySet<InvoiceFormat> = new Set(["factur_x_minimum", "factur_x_basic_wl"]);

export function identifyFormat(syntax: InvoiceSyntax, specification: string | undefined): InvoiceFormat {
  const spec = (specification ?? "").trim().toLowerCase();
  if (spec.includes("urn:fdc:peppol.eu:2017:poacc:billing:3.0")) return "peppol_bis_3";
  if (spec.includes("xrechnung")) return "xrechnung";
  // Factur-X and ZUGFeRD 2.x share these identifiers.
  if (spec.includes("factur-x.eu:1p0:minimum") || spec.includes("zugferd.de:2p0:minimum")) return "factur_x_minimum";
  if (spec.includes("factur-x.eu:1p0:basicwl") || spec.includes("zugferd.de:2p0:basicwl")) return "factur_x_basic_wl";
  if (spec.includes("factur-x.eu:1p0:basic") || spec.includes("zugferd.de:2p0:basic")) return "factur_x_basic";
  if (spec.includes("factur-x.eu:1p0:extended") || spec.includes("zugferd.de:2p0:extended")) return "factur_x_extended";
  // The bare EN 16931 identifier: what a Factur-X "EN 16931" profile
  // declares, and what any other tool writing plain EN 16931 declares
  // too. Named for what it says; whether it came inside a PDF is the
  // container's business, recorded beside it.
  if (spec === "urn:cen.eu:en16931:2017") return "en16931";
  return syntax === "ubl" ? "ubl_other" : "cii_other";
}
