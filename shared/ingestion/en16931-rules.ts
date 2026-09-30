import type { InvoiceFacts } from "../interpreter/types.js";
import type { InvoiceCheckInputs } from "./ubl-parser.js";

/**
 * EN 16931 business rules, checked in our own code — decision 0560.
 *
 * **Why not the official Schematron.** The CEN and KoSIT rules are
 * published as XSLT 2.0 Schematron, and a Worker has no XSLT 2.0
 * processor. Running them would mean a second service or a
 * WebAssembly Saxon, for rules that are, at their core, short and
 * stable. So the rules a receiver needs are written here, each named
 * by its official identifier, and the official files are the yardstick
 * for this code in tests — not something the Worker runs. Agreed with
 * Dan on 29 September 2026.
 *
 * **Which rules.** The ones that say whether an invoice is complete
 * and adds up — the questions an AP team acts on:
 *
 * - presence: BR-01 to BR-16 (the document) and BR-21 to BR-26 (each
 *   line), and BR-27, a line price may not be negative;
 * - arithmetic: BR-CO-10, BR-CO-13, BR-CO-15, BR-CO-16;
 * - BR-CO-9, a VAT identifier starts with a country prefix;
 * - BR-CO-25, an amount due needs a due date or payment terms;
 * - BR-DE-15, for an XRechnung only: the buyer reference is given.
 *
 * **Not checked**: the VAT breakdown rules (BR-S-*, BR-Z-*, BR-E-*
 * and the rest), allowances and charges at line level, and the code
 * lists. They need parts of the document this system does not yet
 * read, and a rule checked against half a document would report
 * failures that are ours, not the supplier's. Listed in
 * `EN16931_RULES_NOT_CHECKED` so the gap is stated where the rules are.
 *
 * **A failure never refuses an invoice.** EN 16931 describes what a
 * supplier should send; what a customer does with one that falls short
 * is theirs to decide, with a rule on `en16931.failures`. Refusing at
 * intake would bounce an invoice that is payable because its
 * supplier's software omitted a buyer reference.
 */

export const EN16931_RULES = [
  "BR-01", "BR-02", "BR-03", "BR-04", "BR-05", "BR-06", "BR-07", "BR-08",
  "BR-09", "BR-10", "BR-11", "BR-12", "BR-13", "BR-14", "BR-15", "BR-16",
  "BR-21", "BR-22", "BR-23", "BR-24", "BR-25", "BR-26", "BR-27",
  "BR-CO-9", "BR-CO-10", "BR-CO-13", "BR-CO-15", "BR-CO-16", "BR-CO-25",
  "BR-DE-15",
] as const;
export type En16931Rule = (typeof EN16931_RULES)[number];

export const EN16931_RULES_NOT_CHECKED = [
  "VAT breakdown (BR-S, BR-Z, BR-E, BR-AE, BR-IC, BR-G, BR-O, BR-AF, BR-AG, BR-CO-14, BR-CO-17, BR-CO-18)",
  "document and line allowances and charges (BR-31 to BR-44, BR-CO-5 to BR-CO-8)",
  "code lists (BR-CL-*)",
  "the other XRechnung rules (BR-DE-*)",
] as const;

export interface En16931Failure {
  rule: En16931Rule;
  /** What was found, in the terms of the document: a value, a line. */
  detail?: string;
}

export interface En16931Result {
  /** Which rules ran — BR-DE-15 only for an XRechnung. */
  checked: En16931Rule[];
  failed: En16931Failure[];
}

type Line = InvoiceFacts & { lineNumber: number };

const present = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
/** Amounts are to the cent; anything closer than half a cent is equal. */
const same = (a: number, b: number) => Math.abs(a - b) < 0.005;
const money = (n: number) => n.toFixed(2);

export function checkEn16931(
  facts: InvoiceFacts,
  lines: readonly Line[],
  inputs: InvoiceCheckInputs,
  options: {
    xrechnung: boolean;
    /**
     * A supplier's own XML read through a mapping (0561). It declares no
     * specification, being no EN 16931 syntax, so BR-01 does not apply;
     * every other rule does, to what the mapping made of it.
     */
    mapped?: boolean;
  }
): En16931Result {
  const failed: En16931Failure[] = [];
  const checked: En16931Rule[] = EN16931_RULES.filter(
    (r) => (r !== "BR-DE-15" || options.xrechnung) && (r !== "BR-01" || !options.mapped)
  );
  const fail = (rule: En16931Rule, detail?: string) => failed.push(detail ? { rule, detail } : { rule });

  // The document must say these.
  const required: Array<[En16931Rule, string]> = [
    ["BR-01", "BT-24"],
    ["BR-02", "BT-1"],
    ["BR-03", "BT-2"],
    ["BR-04", "BT-3"],
    ["BR-05", "BT-5"],
    ["BR-06", "BT-27"],
    ["BR-07", "BT-44"],
  ];
  for (const [rule, term] of required) if (checked.includes(rule) && !present(facts[term])) fail(rule);
  if (!inputs.sellerAddress) fail("BR-08");
  if (!present(facts["BT-40"])) fail("BR-09");
  if (!inputs.buyerAddress) fail("BR-10");
  if (!present(facts["BT-55"])) fail("BR-11");
  const totals: Array<[En16931Rule, string]> = [
    ["BR-12", "BT-106"],
    ["BR-13", "BT-109"],
    ["BR-14", "BT-112"],
    ["BR-15", "BT-115"],
  ];
  for (const [rule, term] of totals) if (num(facts[term]) === undefined) fail(rule);
  if (lines.length === 0) fail("BR-16");

  // Each line must say these; a failure names the lines.
  const perLine: Array<[En16931Rule, string]> = [
    ["BR-21", "BT-126"],
    ["BR-22", "BT-129"],
    ["BR-23", "BT-130"],
    ["BR-24", "BT-131"],
    ["BR-25", "BT-153"],
    ["BR-26", "BT-146"],
  ];
  for (const [rule, term] of perLine) {
    const missing = lines.filter((l) => !present(l[term])).map((l) => l.lineNumber);
    if (missing.length > 0) fail(rule, `line ${missing.join(", ")}`);
  }
  const negative = lines.filter((l) => (num(l["BT-146"]) ?? 0) < 0).map((l) => l.lineNumber);
  if (negative.length > 0) fail("BR-27", `line ${negative.join(", ")}`);

  // VAT identifiers start with a two-letter country prefix (EL for Greece).
  for (const term of ["BT-31", "BT-48"]) {
    const id = facts[term];
    if (present(id) && !/^[A-Z]{2}/.test(String(id).trim())) {
      fail("BR-CO-9", `${term} ${String(id).trim()}`);
      break;
    }
  }

  // The arithmetic, each only where its inputs are present: a missing
  // total is already its own failure above, and is not reported twice.
  const bt106 = num(facts["BT-106"]);
  const lineAmounts = lines.map((l) => num(l["BT-131"]));
  if (bt106 !== undefined && lines.length > 0 && lineAmounts.every((a) => a !== undefined)) {
    const sum = (lineAmounts as number[]).reduce((a, b) => a + b, 0);
    if (!same(sum, bt106)) fail("BR-CO-10", `BT-106 ${money(bt106)}, lines add up to ${money(sum)}`);
  }
  const bt109 = num(facts["BT-109"]);
  if (bt109 !== undefined && bt106 !== undefined) {
    const expected = bt106 - (inputs.allowanceTotal ?? 0) + (inputs.chargeTotal ?? 0);
    if (!same(expected, bt109)) fail("BR-CO-13", `BT-109 ${money(bt109)}, expected ${money(expected)}`);
  }
  const bt112 = num(facts["BT-112"]);
  if (bt112 !== undefined && bt109 !== undefined) {
    const expected = bt109 + (inputs.vatTotalAll ?? num(facts["BT-110"]) ?? 0);
    if (!same(expected, bt112)) fail("BR-CO-15", `BT-112 ${money(bt112)}, expected ${money(expected)}`);
  }
  const bt115 = num(facts["BT-115"]);
  if (bt115 !== undefined && bt112 !== undefined) {
    const expected = bt112 - (inputs.prepaid ?? 0) + (inputs.rounding ?? 0);
    if (!same(expected, bt115)) fail("BR-CO-16", `BT-115 ${money(bt115)}, expected ${money(expected)}`);
  }
  if (bt115 !== undefined && bt115 > 0 && !present(facts["BT-9"]) && !present(facts["BT-20"])) fail("BR-CO-25");

  if (options.xrechnung && !present(facts["BT-10"])) fail("BR-DE-15");

  return { checked, failed };
}
