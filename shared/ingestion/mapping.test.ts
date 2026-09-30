import { describe, expect, it } from "vitest";
import { applyChain, validateChain, FUNCTION_NAMES, describeFunctions } from "./mapping-functions.js";
import { applyMapping, describeXml, validateMapping, type MappingDefinition } from "./mapping-engine.js";
import { buildFunctionPrompt, compileFunction, parseFunctionOutput, workedExamples } from "./function-compiler.js";

/**
 * Decision 0561 — supplier mappings: the function vocabulary, reading a
 * supplier's own XML through a mapping, and compiling a function from
 * plain words.
 */

const run = (fn: string, value: string | number | null, args: Record<string, string | number> = {}) =>
  applyChain([{ fn: fn as never, args }], value);

describe("the functions", () => {
  it("read a date in the pattern the invoice writes it", () => {
    expect(run("read_date", "29.09.2026", { pattern: "dd.MM.yyyy" })).toEqual({ ok: true, value: "2026-09-29" });
    expect(run("read_date", "1/10/26", { pattern: "d/M/yy" })).toEqual({ ok: true, value: "2026-10-01" });
    expect(run("read_date", "20260929", { pattern: "yyyyMMdd" })).toEqual({ ok: true, value: "2026-09-29" });
    expect(run("read_date", "2026-09-29", { pattern: "dd.MM.yyyy" })).toEqual({ ok: false, reason: '"2026-09-29" is not a date written dd.MM.yyyy' });
    expect(run("read_date", "31.02.2026", { pattern: "dd.MM.yyyy" })).toEqual({ ok: false, reason: '"31.02.2026" is not a real date' });
  });

  it("write a date in another pattern", () => {
    expect(run("write_date", "2026-09-29", { pattern: "MM/dd/yyyy" })).toEqual({ ok: true, value: "09/29/2026" });
    expect(run("write_date", "2026-10-01", { pattern: "M/d/yy" })).toEqual({ ok: true, value: "10/1/26" });
  });

  it("read amounts with a decimal comma or a decimal point", () => {
    expect(run("decimal_comma", "1.234,56")).toEqual({ ok: true, value: 1234.56 });
    expect(run("decimal_comma", "45,50")).toEqual({ ok: true, value: 45.5 });
    expect(run("decimal_comma", "-12,00")).toEqual({ ok: true, value: -12 });
    expect(run("decimal_comma", "abc").ok).toBe(false);
    expect(run("number", "1,234.56")).toEqual({ ok: true, value: 1234.56 });
  });

  it("change text, and give a fixed value", () => {
    expect(run("remove_prefix", "PO-4471", { prefix: "PO-" })).toEqual({ ok: true, value: "4471" });
    expect(run("remove_spaces", "DE89 3704 0044")).toEqual({ ok: true, value: "DE893704" + "0044" });
    expect(run("first_letters", "DE812345678", { n: 2 })).toEqual({ ok: true, value: "DE" });
    expect(run("always", "anything", { value: "380" })).toEqual({ ok: true, value: "380" });
    expect(run("if_empty", "", { value: "EUR" })).toEqual({ ok: true, value: "EUR" });
    expect(run("if_empty", "GBP", { value: "EUR" })).toEqual({ ok: true, value: "GBP" });
  });

  it("turn countries and units into codes, and back", () => {
    expect(run("country_to_code", "Deutschland")).toEqual({ ok: true, value: "DE" });
    expect(run("country_to_code", "United Kingdom")).toEqual({ ok: true, value: "GB" });
    expect(run("country_to_code", "uk")).toEqual({ ok: true, value: "GB" });
    expect(run("country_to_code", "Atlantis").ok).toBe(false);
    expect(run("code_to_country", "DE", { language: "en" })).toEqual({ ok: true, value: "Germany" });
    expect(run("code_to_country", "GB", { language: "de" })).toEqual({ ok: true, value: "Vereinigtes Königreich" });
    expect(run("unit_code", "Stk")).toEqual({ ok: true, value: "H87" });
    expect(run("unit_code", "Std.")).toEqual({ ok: true, value: "HUR" });
    expect(run("unit_code", "Fass").ok).toBe(false);
  });

  it("chain, stopping at the first that fails", () => {
    expect(applyChain([{ fn: "trim" }, { fn: "decimal_comma" }, { fn: "multiply", args: { by: -1 } }], " 12,50 ")).toEqual({ ok: true, value: -12.5 });
    expect(applyChain([{ fn: "decimal_comma" }, { fn: "round", args: { places: 0 } }], "x").ok).toBe(false);
  });

  it("refuse a chain that is not in the vocabulary, too long, or missing an argument", () => {
    expect(validateChain([{ fn: "eval" }])).toBe('"eval" is not a function');
    expect(validateChain(Array(6).fill({ fn: "trim" }))).toBe("a chain has at most 5 steps");
    expect(validateChain([{ fn: "read_date" }])).toBe("read_date needs pattern");
    expect(validateChain([{ fn: "read_date", args: { pattern: "banana" } }])).toBe('"banana" is not a date pattern');
    expect(validateChain([{ fn: "round", args: { places: "2" } }])).toBe("round's places is a number");
    expect(validateChain([{ fn: "trim", args: { x: 1 } }])).toBe("trim takes no x");
    expect(validateChain([{ fn: "read_date", args: { pattern: "dd.MM.yyyy" } }])).toBeNull();
  });

  it("describe every function for the compiler, from the one list", () => {
    const doc = describeFunctions();
    for (const name of FUNCTION_NAMES) expect(doc).toContain(`- ${name}(`);
  });
});

const MUNCH = `<?xml version="1.0" encoding="UTF-8"?>
<Rechnung xmlns="urn:munch:rechnung" version="2">
  <Kopf>
    <Rechnungsnummer>00088240</Rechnungsnummer>
    <Datum>29.09.2026</Datum>
    <Faelligkeit>29.10.2026</Faelligkeit>
    <Waehrung>EUR</Waehrung>
    <Bestellnummer>PO-4471</Bestellnummer>
  </Kopf>
  <Lieferant><Name>Munch GmbH</Name><UStIdNr>DE812345678</UStIdNr></Lieferant>
  <Kunde><Name>Acme UK Ltd</Name><Land>Vereinigtes Königreich</Land></Kunde>
  <Position nr="1"><Beschreibung>Hydraulic seal kit</Beschreibung><Menge>12</Menge><Einheit>Stk</Einheit><Einzelpreis>45,50</Einzelpreis><Netto>546,00</Netto><MwStSatz>19</MwStSatz></Position>
  <Position nr="2"><Beschreibung>Fitting</Beschreibung><Menge>2</Menge><Einheit>Stk</Einheit><Einzelpreis>10,00</Einzelpreis><Netto>20,00</Netto><MwStSatz>19</MwStSatz></Position>
  <Summen><Netto>566,00</Netto><MwSt>107,54</MwSt><Brutto>673,54</Brutto></Summen>
</Rechnung>`;

const dc = [{ fn: "decimal_comma" as const }];
const MAPPING: MappingDefinition = {
  root: "Rechnung",
  linesPath: "Rechnung/Position",
  lines: [
    { target: "BT-1", source: "Rechnung/Kopf/Rechnungsnummer", fx: [] },
    { target: "BT-2", source: "Rechnung/Kopf/Datum", fx: [{ fn: "read_date", args: { pattern: "dd.MM.yyyy" } }] },
    { target: "BT-3", source: null, fx: [{ fn: "always", args: { value: "380" } }] },
    { target: "BT-5", source: "Rechnung/Kopf/Waehrung", fx: [] },
    { target: "BT-9", source: "Rechnung/Kopf/Faelligkeit", fx: [{ fn: "read_date", args: { pattern: "dd.MM.yyyy" } }] },
    { target: "BT-13", source: "Rechnung/Kopf/Bestellnummer", fx: [] },
    { target: "BT-27", source: "Rechnung/Lieferant/Name", fx: [] },
    { target: "BT-31", source: "Rechnung/Lieferant/UStIdNr", fx: [] },
    { target: "BT-40", source: "Rechnung/Lieferant/UStIdNr", fx: [{ fn: "first_letters", args: { n: 2 } }] },
    { target: "BT-44", source: "Rechnung/Kunde/Name", fx: [] },
    { target: "BT-55", source: "Rechnung/Kunde/Land", fx: [{ fn: "country_to_code" }] },
    { target: "BT-106", source: "Rechnung/Summen/Netto", fx: dc },
    { target: "BT-109", source: "Rechnung/Summen/Netto", fx: dc },
    { target: "BT-110", source: "Rechnung/Summen/MwSt", fx: dc },
    { target: "BT-112", source: "Rechnung/Summen/Brutto", fx: dc },
    { target: "BT-115", source: "Rechnung/Summen/Brutto", fx: dc },
    { target: "BT-126", source: "@nr", fx: [] },
    { target: "BT-129", source: "Menge", fx: [] },
    { target: "BT-130", source: "Einheit", fx: [{ fn: "unit_code" }] },
    { target: "BT-131", source: "Netto", fx: dc },
    { target: "BT-146", source: "Einzelpreis", fx: dc },
    { target: "BT-152", source: "MwStSatz", fx: [] },
    { target: "BT-153", source: "Beschreibung", fx: [] },
  ],
};

describe("describeXml", () => {
  it("lists every value with its path and a sample, and finds the repeating lines", () => {
    const d = describeXml(MUNCH);
    expect(d.root).toBe("Rechnung");
    expect(d.repeating[0]).toBe("Rechnung/Position");
    expect(d.elements).toContainEqual({ path: "Rechnung/Kopf/Rechnungsnummer", sample: "00088240", count: 1 });
    expect(d.elements).toContainEqual({ path: "Rechnung/Kopf/Datum", sample: "29.09.2026", count: 1 });
    expect(d.elements).toContainEqual({ path: "Rechnung/Position/Menge", sample: "12", count: 2 });
    expect(d.elements).toContainEqual({ path: "Rechnung/Position/@nr", sample: "1", count: 2 });
    expect(d.elements).toContainEqual({ path: "Rechnung/@version", sample: "2", count: 1 });
    expect(d.elements.some((e) => e.path.includes("xmlns"))).toBe(false);
  });
});

describe("describeXml with one line", () => {
  it("recognises a single line by what such groups are called, and lists every group to choose from", () => {
    const one = MUNCH.replace(/<Position nr="2">[\s\S]*?<\/Position>/, "");
    const d = describeXml(one);
    expect(d.repeating).toEqual(["Rechnung/Position"]);
    expect(d.groups).toEqual(expect.arrayContaining(["Rechnung/Kopf", "Rechnung/Lieferant", "Rechnung/Position", "Rechnung/Summen"]));
  });
});

describe("applyMapping", () => {
  it("makes the facts and lines a UBL invoice would give, and checks them against EN 16931", () => {
    expect(validateMapping(MAPPING)).toBeNull();
    const r = applyMapping(MUNCH, MAPPING);
    expect(r.problems).toEqual([]);
    expect(r.facts).toEqual({
      "BT-1": "00088240", "BT-2": "2026-09-29", "BT-3": "380", "BT-5": "EUR", "BT-9": "2026-10-29", "BT-13": "PO-4471",
      "BT-27": "Munch GmbH", "BT-31": "DE812345678", "BT-40": "DE", "BT-44": "Acme UK Ltd", "BT-55": "GB",
      "BT-106": 566, "BT-109": 566, "BT-110": 107.54, "BT-112": 673.54, "BT-115": 673.54,
    });
    expect(r.lines).toEqual([
      { lineNumber: 1, "BT-126": "1", "BT-129": 12, "BT-130": "H87", "BT-131": 546, "BT-146": 45.5, "BT-152": 19, "BT-153": "Hydraulic seal kit" },
      { lineNumber: 2, "BT-126": "2", "BT-129": 2, "BT-130": "H87", "BT-131": 20, "BT-146": 10, "BT-152": 19, "BT-153": "Fitting" },
    ]);
    // A supplier's own XML declares no specification: BR-01 is not asked of it.
    expect(r.en16931.checked).not.toContain("BR-01");
    expect(r.en16931.failed).toEqual([]);
  });

  it("says which value could not be read, where, and why — the monitor's explanation", () => {
    const wrong = { ...MAPPING, lines: MAPPING.lines.map((l) => (l.target === "BT-2" ? { ...l, fx: [{ fn: "read_date" as const, args: { pattern: "yyyy-MM-dd" } }] } : l)) };
    const r = applyMapping(MUNCH, wrong);
    expect(r.problems).toEqual([
      { target: "BT-2", source: "Rechnung/Kopf/Datum", value: "29.09.2026", reason: '"29.09.2026" is not a date written yyyy-MM-dd' },
    ]);
  });

  it("says when a value needs a function to become what its term needs", () => {
    const bare = { ...MAPPING, lines: MAPPING.lines.map((l) => (l.target === "BT-131" ? { ...l, fx: [] } : l)) };
    const r = applyMapping(MUNCH, bare);
    expect(r.problems.map((p) => [p.target, p.line, p.reason])).toEqual([
      ["BT-131", 1, '"546,00" is not a number; a function such as "decimal comma" can read it'],
      ["BT-131", 2, '"20,00" is not a number; a function such as "decimal comma" can read it'],
    ]);
  });

  it("refuses a document that is not the one the mapping is for", () => {
    expect(() => applyMapping("<Order><Id>1</Id></Order>", MAPPING)).toThrow(/root is <Order>, and the mapping is for <Rechnung>/);
  });

  it("leaves out a term the document does not carry, and EN 16931 says so", () => {
    const lessMunch = MUNCH.replace("<Waehrung>EUR</Waehrung>", "");
    const r = applyMapping(lessMunch, MAPPING);
    expect(r.facts["BT-5"]).toBeUndefined();
    expect(r.en16931.failed.map((f) => f.rule)).toEqual(["BR-05"]);
  });
});

describe("validateMapping", () => {
  it("refuses what cannot be run", () => {
    expect(validateMapping({ ...MAPPING, lines: [{ target: "BT-999", source: "x", fx: [] }] })).toBe('"BT-999" is not a Business Term a mapping can fill');
    expect(validateMapping({ ...MAPPING, lines: [MAPPING.lines[0], MAPPING.lines[0]] })).toBe("BT-1 is mapped twice");
    expect(validateMapping({ ...MAPPING, linesPath: null })).toBe("BT-126 is a line's; choose where the lines repeat first");
    expect(validateMapping({ ...MAPPING, lines: [{ target: "BT-3", source: null, fx: [] }] })).toBe('BT-3 has no source, so it needs a fixed value ("always")');
    expect(validateMapping({ ...MAPPING, lines: [{ target: "BT-2", source: "x", fx: [{ fn: "nope" }] }] })).toBe('BT-2: "nope" is not a function');
  });
});

describe("compiling a function from plain words", () => {
  const context = { target: "BT-2", targetName: "Issue date", kind: "date" as const, samples: ["29.09.2026", "01.10.2026"] };
  const model = (answer: string) => ({ compile: async () => answer });

  it("gives the chain and worked examples computed by our code, not the model", async () => {
    const outcome = await compileFunction(model('{"steps":[{"fn":"read_date","args":{"pattern":"dd.MM.yyyy"}}]}'), "day.month.year", context);
    expect(outcome).toEqual({
      kind: "compiled",
      steps: [{ fn: "read_date", args: { pattern: "dd.MM.yyyy" } }],
      examples: [
        { input: "29.09.2026", output: "2026-09-29" },
        { input: "01.10.2026", output: "2026-10-01" },
      ],
    });
  });

  it("refuses in words what the functions cannot do, and anything outside the vocabulary", async () => {
    expect(await compileFunction(model('{"refused":"No function writes a country in its own language."}'), "own language", context)).toEqual({
      kind: "refused",
      reason: "No function writes a country in its own language.",
    });
    expect((await compileFunction(model('{"steps":[{"fn":"translate","args":{}}]}'), "translate it", context)).kind).toBe("refused");
    expect((await compileFunction(model("I think you want a date."), "x", context)).kind).toBe("refused");
    expect(await compileFunction(model("{}"), "   ", context)).toEqual({ kind: "refused", reason: "Say what should happen to the value." });
  });

  it("shows a sample the chain cannot handle as a failed example", () => {
    expect(workedExamples([{ fn: "read_date", args: { pattern: "dd.MM.yyyy" } }], ["29.09.2026", "2026-09-29"])).toEqual([
      { input: "29.09.2026", output: "2026-09-29" },
      { input: "2026-09-29", reason: '"2026-09-29" is not a date written dd.MM.yyyy' },
    ]);
  });

  it("gives the model the vocabulary, the target and the real samples", () => {
    const prompt = buildFunctionPrompt("day.month.year", context);
    expect(prompt).toContain("- read_date(pattern: text)");
    expect(prompt).toContain("BT-2 (Issue date)");
    expect(prompt).toContain('"29.09.2026"');
    expect(parseFunctionOutput('Sure: {"steps":[{"fn":"trim"}]}')).toEqual({ kind: "compiled", steps: [{ fn: "trim", args: {} }] });
  });
});
