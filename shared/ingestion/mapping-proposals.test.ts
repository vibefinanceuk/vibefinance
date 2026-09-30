import { describe, expect, it } from "vitest";
import { describeXml, type MappingDefinition } from "./mapping-engine.js";
import { arithmetic, buildProposalPrompt, nameScore, proposeMapping, scoreProposals, valueScore, type ProposalContext } from "./mapping-proposals.js";

/**
 * **AI proposals, scored by our code — decision 0570.** The model says
 * which element becomes which term; the confidence comes from names,
 * values, and whether the invoice adds up.
 */

const XML = `<Rechnung>
  <Kopf><Rechnungsnummer>88240</Rechnungsnummer><Datum>29.09.2026</Datum><Waehrung>EUR</Waehrung><Bemerkung>danke</Bemerkung></Kopf>
  <Lieferant><Name>Lager Nord GmbH</Name><UStIdNr>DE298765432</UStIdNr></Lieferant>
  <Position nr="1"><Beschreibung>Palettenregal</Beschreibung><Menge>4</Menge><Einzelpreis>120,00</Einzelpreis><Netto>480,00</Netto></Position>
  <Position nr="2"><Beschreibung>Schrauben</Beschreibung><Menge>100</Menge><Einzelpreis>0,25</Einzelpreis><Netto>25,00</Netto></Position>
  <Summen><Netto>505,00</Netto><MwSt>95,95</MwSt><Brutto>600,95</Brutto></Summen>
</Rechnung>`;

const TARGETS = [
  { id: "BT-1", name: "Invoice number", kind: "text" as const, line: false, required: true },
  { id: "BT-2", name: "Issue date", kind: "date" as const, line: false, required: true },
  { id: "BT-5", name: "Currency", kind: "text" as const, line: false, required: true },
  { id: "BT-27", name: "Seller name", kind: "text" as const, line: false, required: true },
  { id: "BT-31", name: "Seller VAT id", kind: "text" as const, line: false, required: false },
  { id: "BT-106", name: "Sum of line net amounts", kind: "number" as const, line: false, required: true },
  { id: "BT-109", name: "Total without VAT", kind: "number" as const, line: false, required: true },
  { id: "BT-110", name: "Total VAT", kind: "number" as const, line: false, required: false },
  { id: "BT-112", name: "Total with VAT", kind: "number" as const, line: false, required: true },
  { id: "BT-129", name: "Quantity", kind: "number" as const, line: true, required: true },
  { id: "BT-131", name: "Line net amount", kind: "number" as const, line: true, required: true },
  { id: "BT-146", name: "Item net price", kind: "number" as const, line: true, required: true },
  { id: "BT-153", name: "Item name", kind: "text" as const, line: true, required: true },
];

function context(def: Partial<MappingDefinition> = {}): ProposalContext {
  return {
    described: describeXml(XML),
    xml: XML,
    def: { root: "Rechnung", linesPath: "Rechnung/Position", lines: [], ...def },
    targets: TARGETS,
  };
}

const dc = [{ fn: "decimal_comma", args: {} }];
const answer = (lines: unknown[]) => JSON.stringify({ lines });
const GOOD = [
  { target: "BT-1", source: "Rechnung/Kopf/Rechnungsnummer", steps: [], why: "invoice number" },
  { target: "BT-2", source: "Rechnung/Kopf/Datum", steps: [{ fn: "read_date", args: { pattern: "dd.MM.yyyy" } }] },
  { target: "BT-5", source: "Rechnung/Kopf/Waehrung", steps: [] },
  { target: "BT-27", source: "Rechnung/Lieferant/Name", steps: [] },
  { target: "BT-31", source: "Rechnung/Lieferant/UStIdNr", steps: [] },
  { target: "BT-106", source: "Rechnung/Summen/Netto", steps: dc },
  { target: "BT-109", source: "Rechnung/Summen/Netto", steps: dc },
  { target: "BT-110", source: "Rechnung/Summen/MwSt", steps: dc },
  { target: "BT-112", source: "Rechnung/Summen/Brutto", steps: dc },
  { target: "BT-129", source: "Rechnung/Position/Menge", steps: [] },
  { target: "BT-131", source: "Rechnung/Position/Netto", steps: dc },
  { target: "BT-146", source: "Rechnung/Position/Einzelpreis", steps: dc },
  { target: "BT-153", source: "Rechnung/Position/Beschreibung", steps: [] },
];

describe("the signals", () => {
  it("scores names in English and German, a name inside another, and the element's group", () => {
    expect(nameScore("Rechnung/Kopf/Rechnungsnummer", "BT-1")).toBe(1);
    expect(nameScore("CSV/First/Währung", "BT-5")).toBe(1);
    expect(nameScore("Rechnung/Kopf/Rechnungsnr_Lieferant", "BT-1")).toBe(0.8);
    expect(nameScore("Rechnung/Summen/Betrag", "BT-106")).toBe(0.8);
    expect(nameScore("Rechnung/Anhang/Hinweis", "BT-106")).toBe(0);
    expect(nameScore("Rechnung/Kopf/Bemerkung", "BT-1")).toBe(0);
    expect(nameScore("Rechnung/Position/@nr", "BT-126")).toBe(1);
  });

  it("scores what a value becomes: the term's own check, its kind, or neither", () => {
    expect(valueScore("BT-2", "2026-09-29")).toEqual({ score: 1 });
    expect(valueScore("BT-2", "29.09.2026")).toEqual({ score: 0, reason: '"29.09.2026" is not a date' });
    expect(valueScore("BT-5", "EUR")).toEqual({ score: 1 });
    expect(valueScore("BT-5", "Euro")).toEqual({ score: 0.3, reason: '"Euro" is not the usual form for BT-5' });
    expect(valueScore("BT-31", "DE298765432")).toEqual({ score: 1 });
    expect(valueScore("BT-112", "600,95")).toEqual({ score: 0, reason: '"600,95" is not a number' });
    expect(valueScore("BT-27", "Lager Nord GmbH")).toEqual({ score: 0.8 });
  });

  it("says, per term, whether the invoice adds up with it", () => {
    const lines = [
      { lineNumber: 1, "BT-129": 4, "BT-146": 120, "BT-131": 480 },
      { lineNumber: 2, "BT-129": 100, "BT-146": 0.25, "BT-131": 25 },
    ];
    expect(arithmetic({ "BT-106": 505, "BT-109": 505, "BT-110": 95.95, "BT-112": 600.95 }, lines)).toEqual({
      "BT-106": true, "BT-109": true, "BT-110": true, "BT-112": true, "BT-129": true, "BT-131": true, "BT-146": true,
    });
    // Net taken from the gross by mistake: the sums it is in disagree.
    expect(arithmetic({ "BT-106": 600.95, "BT-109": 600.95, "BT-110": 95.95, "BT-112": 600.95 }, lines)).toMatchObject({ "BT-106": false, "BT-112": false });
    expect(arithmetic({ "BT-1": "88240" }, [])).toEqual({});
  });
});

describe("scoring the model's proposals", () => {
  it("scores a good mapping high, with every sum agreeing, and shows what each sample becomes", () => {
    const { proposals, dropped } = scoreProposals(answer(GOOD), context());
    expect(dropped).toBe(0);
    const by = Object.fromEntries(proposals.map((p) => [p.target, p]));
    expect(by["BT-112"]).toMatchObject({ confidence: 100, signals: { name: 1, value: 1, addsUp: true }, sample: "600,95", becomes: 600.95 });
    expect(by["BT-2"]).toMatchObject({ confidence: 100, becomes: "2026-09-29" });
    expect(by["BT-129"].line).toEqual({ target: "BT-129", source: "Menge", fx: [], origin: "ai" });
    expect(by["BT-1"].why).toBe("invoice number");
    expect(proposals.every((p) => p.confidence >= 80)).toBe(true);
    // Highest first.
    expect(proposals.map((p) => p.confidence)).toEqual([...proposals.map((p) => p.confidence)].sort((a, b) => b - a));
  });

  it("scores a wrong total low, because the invoice no longer adds up", () => {
    const wrong = GOOD.map((l) => (l.target === "BT-109" ? { ...l, source: "Rechnung/Summen/Brutto" } : l));
    const by = Object.fromEntries(scoreProposals(answer(wrong), context()).proposals.map((p) => [p.target, p]));
    expect(by["BT-109"].signals.addsUp).toBe(false);
    expect(by["BT-109"].problem).toBe("the invoice does not add up with it");
    expect(by["BT-109"].confidence).toBeLessThan(60);
  });

  it("scores a missing function by its value: an amount left with a decimal comma", () => {
    const noComma = GOOD.map((l) => (l.target === "BT-110" ? { ...l, steps: [] } : l));
    const by = Object.fromEntries(scoreProposals(answer(noComma), context()).proposals.map((p) => [p.target, p]));
    expect(by["BT-110"]).toMatchObject({ signals: { value: 0 }, problem: '"95,95" is not a number' });
    expect(by["BT-110"].confidence).toBeLessThan(60);
  });

  it("drops what cannot be a line: an element not in the file, a function not in the list, the wrong scope, a term already mapped", () => {
    const { proposals, dropped } = scoreProposals(
      answer([
        { target: "BT-1", source: "Rechnung/Kopf/Nummer", steps: [] },
        { target: "BT-2", source: "Rechnung/Kopf/Datum", steps: [{ fn: "guess_date", args: {} }] },
        { target: "BT-153", source: "Rechnung/Kopf/Bemerkung", steps: [] },
        { target: "BT-27", source: "Rechnung/Position/Beschreibung", steps: [] },
        { target: "BT-5", source: "Rechnung/Kopf/Waehrung", steps: [] },
        { target: "BT-99", source: "Rechnung/Kopf/Waehrung", steps: [] },
      ]),
      context({ lines: [{ target: "BT-5", source: "Rechnung/Kopf/Waehrung", fx: [] }] })
    );
    expect(proposals).toEqual([]);
    expect(dropped).toBe(6);
  });

  it("survives an answer that is not JSON", () => {
    expect(scoreProposals("I think the invoice number is Rechnungsnummer.", context())).toEqual({ proposals: [], dropped: 0 });
  });
});

describe("proposing", () => {
  it("tells the model the elements with their scope and samples, and only the terms still to map", () => {
    const prompt = buildProposalPrompt(context({ lines: [{ target: "BT-1", source: "Rechnung/Kopf/Rechnungsnummer", fx: [] }] }));
    expect(prompt).toContain('- Rechnung/Kopf/Datum [whole invoice]: "29.09.2026"');
    expect(prompt).toContain('- Rechnung/Position/Menge [each line]: "4"');
    expect(prompt).toContain("- BT-2: Issue date (date, whole invoice, required)");
    expect(prompt).not.toContain("- BT-1: Invoice number");
  });

  it("names the required terms nothing covers", async () => {
    const model = { compile: async () => answer(GOOD.filter((l) => l.target !== "BT-27" && l.target !== "BT-153")) } as never;
    const result = await proposeMapping(model, context());
    expect(result.missingRequired).toEqual(["BT-27", "BT-153"]);
    expect(result.proposals).toHaveLength(11);
  });
});
