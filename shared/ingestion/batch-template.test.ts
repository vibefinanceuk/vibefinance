import { describe, expect, it } from "vitest";
import { BATCH_MAX_INVOICES, problemsCsv, readTemplateBatch, templateCsv, TEMPLATE_COLUMNS } from "./batch-template.js";
import { applyMapping, type MappingDefinition } from "./mapping-engine.js";
import { csvToXml, splitCsvByColumn } from "./supplier-csv.js";

/**
 * **Batch upload — decision 0576.** The VibeFinance template read into
 * invoices, one per invoice number and supplier, their totals worked out
 * from the lines; what is wrong said by row. And a supplier's own CSV cut
 * into one per invoice for its mapping.
 */

const HEADER = TEMPLATE_COLUMNS.map((c) => c.name).join(",");
const row = (v: Partial<Record<string, string>>) => TEMPLATE_COLUMNS.map((c) => v[c.name] ?? "").join(",");
const base = { issue_date: "2026-09-30", currency: "EUR", supplier_name: "Hanse Logistik", quantity: "1", vat_rate: "19" };

describe("the VibeFinance template", () => {
  it("is offered with every column and an example that reads cleanly", () => {
    const text = templateCsv();
    expect(text.split("\r\n")[0]).toBe(HEADER);
    const read = readTemplateBatch(text);
    expect(read.problems).toEqual([]);
    expect(read.invoices).toHaveLength(1);
    expect(read.invoices[0]).toMatchObject({ number: "INV-1001", supplier: "Brightwell Supplies", total: 606, problems: [] });
  });

  it("makes one invoice from many rows, its totals from its lines, VAT by rate", () => {
    const text = [
      HEADER,
      row({ ...base, invoice_number: "STMT-09", line_description: "Delivery 1", unit_price: "100.00", purchase_order: "PO-1" }),
      row({ ...base, invoice_number: "STMT-09", line_description: "Delivery 2", quantity: "3", unit_price: "33.33" }),
      row({ ...base, invoice_number: "STMT-09", line_description: "Books", unit_price: "10.00", vat_rate: "7" }),
      row({ ...base, invoice_number: "7781", supplier_name: "", supplier_vat: "DE999", line_description: "Pallet", unit_price: "81.01" }),
    ].join("\n");
    const read = readTemplateBatch(text);
    expect(read.rows).toBe(4);
    expect(read.invoices.map((i) => [i.number, i.rows, i.lines.length, i.total])).toEqual([
      ["STMT-09", [2, 3, 4], 3, 248.69],
      ["7781", [5], 1, 96.4],
    ]);
    const stmt = read.invoices[0];
    // 199.99 at 19% is 38.00; 10.00 at 7% is 0.70.
    expect(stmt.facts).toMatchObject({ "BT-1": "STMT-09", "BT-2": "2026-09-30", "BT-5": "EUR", "BT-13": "PO-1", "BT-27": "Hanse Logistik", "BT-106": 209.99, "BT-110": 38.7, "BT-112": 248.69 });
    expect(stmt.total).toBe(248.69);
    expect(stmt.lines[1]).toMatchObject({ lineNumber: 2, "BT-153": "Delivery 2", "BT-129": 3, "BT-130": "C62", "BT-146": 33.33, "BT-131": 99.99, "BT-151": "S", "BT-152": 19 });
    expect(stmt.lines[2]).toMatchObject({ "BT-152": 7 });
    expect(stmt.en16931?.failed.map((f) => f.rule)).not.toContain("BR-CO-10");
    expect(read.invoices[1].facts).toMatchObject({ "BT-31": "DE999" });
  });

  it("keeps the same number from two suppliers apart", () => {
    const text = [HEADER, row({ ...base, invoice_number: "1", line_description: "a", unit_price: "1" }), row({ ...base, invoice_number: "1", supplier_name: "Other", line_description: "b", unit_price: "1" })].join("\n");
    expect(readTemplateBatch(text).invoices.map((i) => i.supplier)).toEqual(["Hanse Logistik", "Other"]);
  });

  it("says what is wrong, by row, in words", () => {
    const text = [
      HEADER,
      row({ ...base, invoice_number: "A", line_description: "x", unit_price: '"12,50"' }),
      row({ ...base, invoice_number: "A", line_description: "y", unit_price: "1", vat_rate: "" }),
      row({ ...base, invoice_number: "B", line_description: "z", unit_price: "5", currency: "GBP" }),
      row({ ...base, invoice_number: "B", line_description: "z", unit_price: "5", currency: "EUR" }),
      row({ ...base, invoice_number: "C", issue_date: "30.09.2026", line_description: "z", quantity: "2", unit_price: "5", line_net: "11.00" }),
      row({ ...base, invoice_number: "", line_description: "z", unit_price: "5" }),
      row({ ...base, invoice_number: "D", supplier_name: "", currency: "euro", line_description: "", unit_price: "5", vat_rate: "120" }),
    ].join("\n");
    const read = readTemplateBatch(text);
    const byNumber = Object.fromEntries(read.invoices.map((i) => [i.number || i.key, i.problems.map((p) => p.text)]));
    expect(byNumber).toEqual({
      A: ['Row 2: unit_price "12,50" is not a number written with a dot', "Row 3: no VAT rate"],
      B: ["Row 5: currency is EUR, but row 4 says GBP"],
      C: ['Row 6: issue_date "30.09.2026" is not a date written as 2026-09-30', "Row 6: line_net 11.00 is not quantity × unit_price (10.00)"],
      "row-7": ["Row 7: no invoice number"],
      D: ["Row 8: no supplier_name or supplier_vat", 'Row 8: currency "euro" is not a three-letter code such as EUR', "Row 8: no line_description", "Row 8: vat_rate 120 is not a percentage from 0 to 100"],
    });
    expect(read.invoices.find((i) => i.number === "A")?.en16931).toBeNull();
  });

  it("refuses a file without the template's columns, an empty one, and too many invoices", () => {
    expect(readTemplateBatch("number;date\n1;2").problems).toEqual([
      {
        row: 1,
        text: "The file has no column invoice_number, issue_date, currency, line_description, quantity, unit_price, vat_rate, supplier_name or supplier_vat. Download the template to see the columns.",
      },
    ]);
    expect(readTemplateBatch("").problems).toEqual([{ text: "The file is empty." }]);
    expect(readTemplateBatch(HEADER + "\n").problems).toEqual([{ text: "The file has column names and no rows." }]);
    const many = [HEADER, ...Array.from({ length: BATCH_MAX_INVOICES + 1 }, (_, i) => row({ ...base, invoice_number: `N${i}`, line_description: "x", unit_price: "1" }))].join("\n");
    expect(readTemplateBatch(many).problems[0].text).toBe("The file holds 501 invoices. At most 500 are read at once: split it and upload each part.");
  });

  it("reads a semicolon file too, and writes the problems as a CSV to fix from", () => {
    const text = [HEADER.replace(/,/g, ";"), row({ ...base, invoice_number: "A", line_description: "x", unit_price: "1", vat_rate: "" }).replace(/,/g, ";")].join("\n");
    const read = readTemplateBatch(text);
    expect(read.invoices[0].problems).toEqual([{ row: 2, text: "Row 2: no VAT rate" }]);
    expect(problemsCsv(read)).toBe("row,invoice_number,problem\r\n2,A,Row 2: no VAT rate\r\n");
  });
});

describe("a supplier's own CSV, one invoice at a time", () => {
  const def: MappingDefinition = {
    root: "CSV",
    linesPath: "CSV/Row",
    csv: { delimiter: ";", header: true, skip: 1 },
    lines: [
      { target: "BT-1", source: "CSV/First/Rechnungsnr", fx: [] },
      { target: "BT-153", source: "Artikel", fx: [] },
      { target: "BT-131", source: "Netto", fx: [{ fn: "decimal_comma" }] },
      { target: "BT-106", source: "CSV/Row/Netto", fx: [{ fn: "decimal_comma" }] },
    ],
  } as unknown as MappingDefinition;
  const file = 'Export September\nRechnungsnr;Artikel;Netto\n88252;Regal;"100,00"\n88253;Kiste;5,00\n88252;"Schrauben; lang";2,50\n';

  it("cuts it by the invoice number's column, keeping the title line and header, and each part reads as a file", () => {
    const groups = splitCsvByColumn(file, def.csv!, "CSV/First/Rechnungsnr");
    expect(groups.map((g) => [g.value, g.rows])).toEqual([
      ["88252", [3, 5]],
      ["88253", [4]],
    ]);
    expect(csvToXml(groups[0].text, def.csv!).rows).toBe(2);
    const applied = applyMapping(csvToXml(groups[0].text, def.csv!).xml, def);
    expect(applied.facts).toMatchObject({ "BT-1": "88252", "BT-106": 102.5 });
    expect(applied.lines.map((l) => l["BT-153"])).toEqual(["Regal", "Schrauben; lang"]);
  });

  it("says so when the column is not in the file", () => {
    expect(() => splitCsvByColumn(file, def.csv!, "CSV/First/Belegnr")).toThrow("the file has no column the mapping reads the invoice number from");
  });
});
