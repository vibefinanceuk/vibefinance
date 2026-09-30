import { describe, expect, it } from "vitest";
import { buildDocumentRulePrompt, compileDocumentRule, parseDocumentRuleOutput, documentRuleExample } from "./document-rules.js";
import { applyMapping, applyRules, validateMapping, validateRules, type DocumentRule, type MappingDefinition } from "./mapping-engine.js";
import { applyChain } from "./mapping-functions.js";
import { mappableXml } from "./supplier-csv.js";

/**
 * **Rules for the whole invoice — decision 0569.** Defaults and derived
 * values, kept on the mapping, applied after the lines, and compiled from
 * plain words with a worked example our code computes.
 */

const DUE_30: DocumentRule = { target: "BT-9", when: "missing", from: "BT-2", fx: [{ fn: "add_days", args: { days: 30 } }] };
const EUR: DocumentRule = { target: "BT-5", when: "missing", from: null, fx: [{ fn: "always", args: { value: "EUR" } }] };
const BUYER_REF: DocumentRule = { target: "BT-10", when: "missing", from: "BT-13", fx: [] };

describe("add_days", () => {
  it("adds days across a month and a year, and goes back with a negative number", () => {
    expect(applyChain([{ fn: "add_days", args: { days: 30 } }], "2026-09-29")).toEqual({ ok: true, value: "2026-10-29" });
    expect(applyChain([{ fn: "add_days", args: { days: 5 } }], "2026-12-30")).toEqual({ ok: true, value: "2027-01-04" });
    expect(applyChain([{ fn: "add_days", args: { days: -1 } }], "2026-03-01")).toEqual({ ok: true, value: "2026-02-28" });
    expect(applyChain([{ fn: "add_days", args: { days: 30 } }], "29.09.2026")).toEqual({ ok: false, reason: '"29.09.2026" is not an ISO date' });
  });
});

describe("applying rules", () => {
  it("fills a missing term with a default, and works one out from another", () => {
    const facts: Record<string, unknown> = { "BT-2": "2026-09-29", "BT-13": "PO-4711" };
    expect(applyRules(facts as never, [EUR, DUE_30, BUYER_REF])).toEqual([]);
    expect(facts).toEqual({ "BT-2": "2026-09-29", "BT-13": "PO-4711", "BT-5": "EUR", "BT-9": "2026-10-29", "BT-10": "PO-4711" });
  });

  it("leaves a term the invoice has alone when the rule is for when it is missing, and replaces it when always", () => {
    const facts: Record<string, unknown> = { "BT-5": "GBP", "BT-2": "2026-09-29", "BT-9": "2026-10-15" };
    applyRules(facts as never, [EUR, DUE_30]);
    expect(facts).toMatchObject({ "BT-5": "GBP", "BT-9": "2026-10-15" });
    applyRules(facts as never, [{ ...DUE_30, when: "always" }]);
    expect(facts["BT-9"]).toBe("2026-10-29");
  });

  it("does nothing when the term to work from is not on the invoice, and names the rule it could not apply", () => {
    const facts: Record<string, unknown> = {};
    expect(applyRules(facts as never, [DUE_30, BUYER_REF])).toEqual([]);
    expect(facts).toEqual({});
    const bad = applyRules({ "BT-13": "PO-1" } as never, [{ target: "BT-9", when: "missing", from: "BT-13", fx: [{ fn: "add_days", args: { days: 30 } }] }]);
    expect(bad).toEqual([{ target: "BT-9", source: "rule 1 (from BT-13)", value: "PO-1", reason: '"PO-1" is not an ISO date' }]);
  });

  it("lets a later rule work from what an earlier one filled", () => {
    const facts: Record<string, unknown> = {};
    applyRules(facts as never, [{ target: "BT-2", when: "missing", from: null, fx: [{ fn: "always", args: { value: "2026-09-30" } }] }, DUE_30]);
    expect(facts["BT-9"]).toBe("2026-10-30");
  });
});

describe("validating rules", () => {
  it("refuses what a rule cannot do, naming the rule", () => {
    expect(validateRules([EUR, DUE_30], [])).toBeNull();
    expect(validateRules([{ ...EUR, target: "BT-129" }], [])).toBe("rule 1: BT-129 is not a whole-invoice term a rule can fill");
    expect(validateRules([{ ...DUE_30, from: "BT-131" }], [])).toBe("rule 1: BT-131 is not a whole-invoice term to work from");
    expect(validateRules([{ ...DUE_30, when: "sometimes" }], [])).toBe("rule 1: when is missing or always");
    expect(validateRules([{ target: "BT-5", when: "missing", from: null, fx: [] }], [])).toBe("rule 1: with nothing to work from, it needs a fixed value");
    expect(validateRules([{ ...BUYER_REF, from: "BT-10" }], [])).toBe("rule 1: a term cannot be worked out from itself");
    expect(validateRules([{ ...EUR, when: "always" }], [{ target: "BT-5", source: "Rechnung/Kopf/Waehrung", fx: [] }])).toBe(
      "rule 1: BT-5 is mapped from the document, so a rule may fill it only when it is missing"
    );
  });
});

describe("rules in a mapping", () => {
  const CSV = "Rechnungsnr;Datum;Bestellung\n88270;29.09.2026;PO-4711";
  const def: MappingDefinition = {
    root: "CSV",
    linesPath: "CSV/Row",
    csv: { delimiter: ";", header: true, skip: 0 },
    lines: [
      { target: "BT-1", source: "CSV/First/Rechnungsnr", fx: [] },
      { target: "BT-2", source: "CSV/First/Datum", fx: [{ fn: "read_date", args: { pattern: "dd.MM.yyyy" } }] },
      { target: "BT-13", source: "CSV/First/Bestellung", fx: [] },
    ],
    rules: [EUR, DUE_30, BUYER_REF],
  };

  it("are validated with the mapping, and applied after the lines", () => {
    expect(validateMapping(def)).toBeNull();
    expect(validateMapping({ ...def, rules: [{ ...EUR, target: "BT-129" }] })).toBe("rule 1: BT-129 is not a whole-invoice term a rule can fill");
    const applied = applyMapping(mappableXml(CSV, def), def);
    expect(applied.facts).toMatchObject({ "BT-1": "88270", "BT-2": "2026-09-29", "BT-5": "EUR", "BT-9": "2026-10-29", "BT-10": "PO-4711" });
    // BR-CO-25 needs a due date or payment terms: the derived due date meets it.
    expect(applied.en16931.failed.map((f) => f.rule)).not.toContain("BR-CO-25");
  });
});

describe("compiling a rule", () => {
  const terms = [
    { id: "BT-2", name: "Invoice issue date", kind: "date" as const },
    { id: "BT-9", name: "Payment due date", kind: "date" as const },
  ];
  const facts = { "BT-2": "2026-09-29" };

  it("tells the model the whole-invoice terms with this invoice's values", () => {
    const prompt = buildDocumentRulePrompt("the due date is 30 days after the invoice date", { terms, facts, lines: [] });
    expect(prompt).toContain('- BT-2 (Invoice issue date, date): "2026-09-29"');
    expect(prompt).toContain("- BT-9 (Payment due date, date): not on this invoice");
    expect(prompt).toContain("add_days(days: number)");
  });

  it("compiles, with a worked example our code computes, and keeps what was said", async () => {
    const model = { compile: async () => JSON.stringify({ rule: { target: "BT-9", when: "missing", from: "BT-2", steps: [{ fn: "add_days", args: { days: 30 } }] } }) } as never;
    expect(await compileDocumentRule(model, " the due date is 30 days after the invoice date ", { terms, facts, lines: [] })).toEqual({
      kind: "compiled",
      rule: { ...DUE_30, say: "the due date is 30 days after the invoice date" },
      example: { target: "BT-9", before: null, after: "2026-10-29" },
    });
  });

  it("refuses what the model says it cannot do, and a rule outside the shape", async () => {
    const refusing = { compile: async () => '{"refused":"A rule cannot send an email."}' } as never;
    expect(await compileDocumentRule(refusing, "email the supplier", { terms, facts, lines: [] })).toEqual({ kind: "refused", reason: "A rule cannot send an email." });
    expect(parseDocumentRuleOutput('{"rule":{"target":"BT-129","when":"missing","from":null,"steps":[{"fn":"always","args":{"value":"1"}}]}}', [])).toEqual({
      kind: "refused",
      reason: "That needs something a rule cannot do (BT-129 is not a whole-invoice term a rule can fill).",
    });
    expect(await compileDocumentRule(refusing, "  ", { terms, facts, lines: [] })).toEqual({ kind: "refused", reason: "Say what the rule should do." });
  });

  it("shows a value it cannot make in the example, with the reason", () => {
    expect(documentRuleExample({ target: "BT-9", when: "missing", from: "BT-2", fx: [{ fn: "add_days", args: { days: 30 } }] }, { "BT-2": "soon" })).toEqual({
      target: "BT-9",
      before: null,
      reason: '"soon" is not an ISO date',
    });
  });
});
