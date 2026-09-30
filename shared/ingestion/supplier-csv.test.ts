import { describe, expect, it } from "vitest";
import { applyMapping, describeXml, validateMapping, type MappingDefinition } from "./mapping-engine.js";
import type { FunctionStep } from "./mapping-functions.js";
import {
  csvToXml,
  decodeText,
  detectCsvOptions,
  detectDelimiter,
  distinctInColumn,
  looksLikeCsv,
  mappableXml,
  parseCsv,
  validateCsvOptions,
} from "./supplier-csv.js";

/**
 * **A supplier's own CSV — decision 0565.** Read as a small XML document
 * (`CSV/First` and `CSV/Row`), so the mapping engine reads it unchanged.
 */

const LAGER = [
  "Rechnungsnr;Datum;Fällig;Währung;Lieferant;USt-IdNr;Kunde;Land;Pos;Artikel;Menge;Einheit;Einzelpreis;Netto;MwSt;Brutto",
  "88250;29.09.2026;29.10.2026;EUR;Lager Nord GmbH;DE298765432;Acme UK Ltd;GB;1;Palettenregal;4;Stk;120,00;480,00;91,20;571,20",
  '88250;29.09.2026;29.10.2026;EUR;Lager Nord GmbH;DE298765432;Acme UK Ltd;GB;2;"Schrauben; M8";100;Stk;0,25;25,00;4,75;29,75',
].join("\r\n");

const dc: FunctionStep[] = [{ fn: "decimal_comma" }];
const DEF: MappingDefinition = {
  root: "CSV",
  linesPath: "CSV/Row",
  csv: { delimiter: ";", header: true, skip: 0 },
  lines: [
    { target: "BT-1", source: "CSV/First/Rechnungsnr", fx: [] },
    { target: "BT-2", source: "CSV/First/Datum", fx: [{ fn: "read_date", args: { pattern: "dd.MM.yyyy" } }] },
    { target: "BT-3", source: null, fx: [{ fn: "always", args: { value: "380" } }] },
    { target: "BT-5", source: "CSV/First/Währung", fx: [] },
    { target: "BT-27", source: "CSV/First/Lieferant", fx: [] },
    { target: "BT-31", source: "CSV/First/USt-IdNr", fx: [] },
    { target: "BT-40", source: "CSV/First/USt-IdNr", fx: [{ fn: "first_letters", args: { n: 2 } }] },
    { target: "BT-44", source: "CSV/First/Kunde", fx: [] },
    { target: "BT-55", source: "CSV/First/Land", fx: [] },
    { target: "BT-9", source: "CSV/First/Fällig", fx: [{ fn: "read_date", args: { pattern: "dd.MM.yyyy" } }] },
    // Whole-invoice amounts from the rows: each row read, then added up.
    { target: "BT-106", source: "CSV/Row/Netto", fx: dc },
    { target: "BT-109", source: "CSV/Row/Netto", fx: dc },
    { target: "BT-110", source: "CSV/Row/MwSt", fx: dc },
    { target: "BT-112", source: "CSV/Row/Brutto", fx: dc },
    { target: "BT-115", source: "CSV/Row/Brutto", fx: dc },
    { target: "BT-126", source: "Pos", fx: [] },
    { target: "BT-129", source: "Menge", fx: [] },
    { target: "BT-130", source: "Einheit", fx: [{ fn: "unit_code" }] },
    { target: "BT-131", source: "Netto", fx: dc },
    { target: "BT-146", source: "Einzelpreis", fx: dc },
    { target: "BT-153", source: "Artikel", fx: [] },
  ],
};

describe("reading a CSV file", () => {
  it("parses quotes, doubled quotes, separators and line breaks inside quotes, and drops blank lines", () => {
    expect(parseCsv('a;"b;c";"say ""hi"""\r\n\r\n1;"two\nlines";3\n', ";")).toEqual([
      ["a", "b;c", 'say "hi"'],
      ["1", "two\nlines", "3"],
    ]);
  });

  it("guesses the separator and whether the first row holds column names", () => {
    expect(detectDelimiter(LAGER)).toBe(";");
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a\tb\n1\t2")).toBe("\t");
    expect(detectDelimiter("just one column\nand another")).toBeNull();
    expect(detectCsvOptions(LAGER)).toEqual({ delimiter: ";", header: true, skip: 0 });
    expect(detectCsvOptions("88250;29.09.2026;4\n88250;29.09.2026;5").header).toBe(false);
  });

  it("reads UTF-8, and Windows-1252 as Excel saves it, dropping a BOM", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x57, 0xc3, 0xa4]))).toBe("Wä");
    // "Währung;€" in Windows-1252.
    expect(decodeText(new Uint8Array([0x57, 0xe4, 0x68, 0x72, 0x75, 0x6e, 0x67, 0x3b, 0x80]))).toBe("Währung;€");
  });

  it("tells a CSV from XML, a PDF, binary, and a single line of text", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(looksLikeCsv(enc(LAGER))).toBe(true);
    expect(looksLikeCsv(enc("<?xml version='1.0'?><a;b/>\n<c/>"))).toBe(false);
    expect(looksLikeCsv(enc("%PDF-1.7;x\n1;2"))).toBe(false);
    expect(looksLikeCsv(new Uint8Array([0x61, 0x3b, 0x62, 0x0a, 0x00, 0x3b, 0x01]))).toBe(false);
    expect(looksLikeCsv(enc("a;b;c"))).toBe(false);
  });

  it("becomes a document of the first row and every row, with safe element names", () => {
    const { xml, columns, rows } = csvToXml(LAGER, { delimiter: ";", header: true, skip: 0 });
    expect(rows).toBe(2);
    expect(columns.slice(0, 3)).toEqual([
      { name: "Rechnungsnr", element: "Rechnungsnr" },
      { name: "Datum", element: "Datum" },
      { name: "Fällig", element: "Fällig" },
    ]);
    expect(xml.startsWith("<CSV><First><Rechnungsnr>88250</Rechnungsnr>")).toBe(true);
    const odd = csvToXml("Menge (Stk);1. Preis;;Menge (Stk);xmlid\n1;2;3;4;5", { delimiter: ";", header: true, skip: 0 });
    expect(odd.columns.map((c) => c.element)).toEqual(["Menge_Stk", "C_1._Preis", "Column3", "Menge_Stk_2", "C_xmlid"]);
  });

  it("skips lines at the top, and numbers columns where there are no names", () => {
    const text = "Rechnungsexport Lager Nord\n\n88250;4\n88250;5";
    const { columns, rows } = csvToXml(text, { delimiter: ";", header: false, skip: 2 });
    expect(columns.map((c) => c.element)).toEqual(["Column1", "Column2"]);
    expect(rows).toBe(2);
  });

  it("says what is wrong with a file with no rows, and with options it cannot use", () => {
    expect(() => csvToXml("Rechnungsnr;Datum", { delimiter: ";", header: true, skip: 0 })).toThrow("the file has column names and no rows");
    expect(validateCsvOptions({ delimiter: ":", header: true, skip: 0 })).toBe("the separator is one of ; , tab or |");
    expect(validateCsvOptions({ delimiter: ";", header: "yes", skip: 0 })).toMatch(/yes or no/);
    expect(validateCsvOptions({ delimiter: ";", header: true, skip: 99 })).toMatch(/0 to 50/);
  });

  it("counts the invoices in a file by the column its invoice number comes from", () => {
    const options = { delimiter: ";" as const, header: true, skip: 0 };
    expect(distinctInColumn(LAGER, options, "CSV/First/Rechnungsnr")).toEqual(["88250"]);
    expect(distinctInColumn(`${LAGER}\r\n88251;30.09.2026;EUR`, options, "CSV/First/Rechnungsnr")).toEqual(["88250", "88251"]);
  });
});

describe("a CSV through the mapping engine", () => {
  it("is described with the first row and the rows as groups, the rows as the lines", () => {
    const d = describeXml(mappableXml(LAGER, { root: "CSV", csv: DEF.csv }));
    expect(d.root).toBe("CSV");
    expect(d.repeating[0]).toBe("CSV/Row");
    expect(d.groups).toEqual(expect.arrayContaining(["CSV/First", "CSV/Row"]));
    expect(d.elements.find((e) => e.path === "CSV/First/Rechnungsnr")).toMatchObject({ sample: "88250", count: 1 });
  });

  it("recognises the line group of a file with a single row", () => {
    const one = LAGER.split("\r\n").slice(0, 2).join("\n");
    expect(describeXml(mappableXml(one, { root: "CSV", csv: DEF.csv })).repeating[0]).toBe("CSV/Row");
  });

  it("gives the facts and lines, and passes EN 16931", () => {
    expect(validateMapping(DEF)).toBeNull();
    const applied = applyMapping(mappableXml(LAGER, DEF), DEF);
    expect(applied.problems).toEqual([]);
    expect(applied.facts).toMatchObject({ "BT-1": "88250", "BT-2": "2026-09-29", "BT-31": "DE298765432", "BT-40": "DE" });
    // The totals are the rows added up: 480,00 + 25,00, and 91,20 + 4,75.
    expect(applied.facts).toMatchObject({ "BT-106": 505, "BT-109": 505, "BT-110": 95.95, "BT-112": 600.95, "BT-115": 600.95 });
    expect(applied.lines).toHaveLength(2);
    expect(applied.lines[1]).toMatchObject({ lineNumber: 2, "BT-153": "Schrauben; M8", "BT-129": 100, "BT-131": 25, "BT-146": 0.25, "BT-130": "H87" });
    expect(applied.en16931.failed).toEqual([]);
  });

  it("leaves out an empty cell, as a term the file does not carry", () => {
    const gap = LAGER.replace(';2;"Schrauben; M8";100;', ';2;"Schrauben; M8";;');
    const applied = applyMapping(mappableXml(gap, DEF), DEF);
    expect(applied.lines[1]["BT-129"]).toBeUndefined();
  });

  it("names the row whose amount it could not add up", () => {
    const bad = LAGER.replace(";25,00;4,75;29,75", ";25,00;4,75;n/a");
    const applied = applyMapping(mappableXml(bad, DEF), DEF);
    expect(applied.problems.filter((p) => p.target === "BT-112")).toEqual([
      expect.objectContaining({ target: "BT-112", line: 2, value: "n/a", source: "CSV/Row/Brutto" }),
    ]);
    expect(applied.facts["BT-112"]).toBeUndefined();
  });

  it("refuses CSV options on a mapping that is not for a CSV, and a CSV mapping without them", () => {
    expect(validateMapping({ ...DEF, root: "Rechnung" })).toBe("only a CSV mapping has CSV options");
    expect(validateMapping({ ...DEF, csv: undefined })).toBe("CSV options are an object");
  });
});
