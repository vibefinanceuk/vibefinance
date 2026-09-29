import type { InvoiceFacts } from "../interpreter/types.js";
import { parseCiiInvoice } from "./cii-parser.js";
import { checkEn16931, type En16931Result } from "./en16931-rules.js";
import { BELOW_EN16931, identifyFormat, type InvoiceFormat, type InvoiceSyntax } from "./invoice-format.js";
import { UblParseError, parseUblInvoice } from "./ubl-parser.js";

/**
 * One entry point for an XML invoice, whatever its syntax — decision
 * 0560.
 *
 * Every path that has XML in hand (a bare XML attachment, the XML
 * inside a hybrid PDF, the `/capture-xml` API) calls this and gets the
 * same thing back: the facts, the lines, which format the document is,
 * and what the EN 16931 checks found. Before it, each called
 * `parseUblInvoice` directly, which is how a Factur-X — CII by
 * definition — came to be refused for not being UBL.
 *
 * The syntax is read from the root element, the only reliable place:
 * `<Invoice>` is UBL, `<CrossIndustryInvoice>` is CII. A `<CreditNote>`
 * is refused in words rather than as "no root <Invoice>", because
 * "this is a credit note and we do not read those yet" is something a
 * person can act on.
 */

export class InvoiceXmlError extends UblParseError {}

export interface ReadInvoiceXml {
  facts: InvoiceFacts;
  lines: Array<InvoiceFacts & { lineNumber: number }>;
  syntax: InvoiceSyntax;
  format: InvoiceFormat;
  /** Null where the format is below EN 16931 and was not checked. */
  en16931: En16931Result | null;
}

/**
 * The root element's local name, or null where there is none. Read from
 * the text rather than by parsing the whole document twice: the first
 * tag that is not a declaration, comment or processing instruction.
 */
export function rootElementOf(xml: string): string | null {
  const body = xml.replace(/^\uFEFF/, "").replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/g, "");
  const match = /<(?:[\w.-]+:)?([\w.-]+)[\s>/]/.exec(body);
  return match ? match[1] : null;
}

export function readInvoiceXml(xml: string): ReadInvoiceXml {
  const root = rootElementOf(xml);
  let syntax: InvoiceSyntax;
  let parsed;
  try {
    if (root === "CrossIndustryInvoice") {
      syntax = "cii";
      parsed = parseCiiInvoice(xml);
    } else if (root === "CreditNote") {
      throw new UblParseError("this is a credit note, and credit notes are not read yet");
    } else if (root === "CrossIndustryDocument") {
      // ZUGFeRD 1.0: an older CII, before EN 16931 existed.
      throw new UblParseError("this is a ZUGFeRD 1.0 invoice, which predates EN 16931 and is not read");
    } else {
      // UBL, or something that is not an invoice at all — the UBL parser
      // is the one that says which, as it always has.
      syntax = "ubl";
      parsed = parseUblInvoice(xml);
    }
  } catch (err) {
    if (err instanceof UblParseError && !(err instanceof InvoiceXmlError)) throw new InvoiceXmlError(err.message);
    throw err;
  }

  const format = identifyFormat(syntax, parsed.facts["BT-24"] as string | undefined);
  const en16931 = BELOW_EN16931.has(format)
    ? null
    : checkEn16931(parsed.facts, parsed.lines, parsed.check, { xrechnung: format === "xrechnung" });

  return { facts: parsed.facts, lines: parsed.lines, syntax, format, en16931 };
}

/**
 * The facts a rule can test — `intake.format`, `en16931.checked`,
 * `en16931.failures` — in the same comma-separated shape as
 * `validation.failures`, so `en16931.failures contains BR-CO-10` works
 * with the operators that exist.
 */
export function formatFacts(read: ReadInvoiceXml): Record<string, string | boolean> {
  return {
    "intake.format": read.format,
    "en16931.checked": read.en16931 !== null,
    "en16931.failures": read.en16931 === null ? "" : read.en16931.failed.map((f) => f.rule).join(","),
  };
}
