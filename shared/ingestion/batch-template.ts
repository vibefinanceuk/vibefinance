import type { InvoiceFacts } from "../interpreter/types.js";
import { checkEn16931, type En16931Result } from "./en16931-rules.js";
import { detectDelimiter, parseCsv } from "./supplier-csv.js";

/**
 * **The VibeFinance batch template — decision 0576**, Create → Batch
 * upload. One row per invoice line; rows sharing an invoice number (and
 * supplier) are one invoice, with a line for each row. That is also how
 * a statement becomes "one invoice from many rows", as Dan asked.
 *
 * Read by our own code rather than as a mapping: an invoice's totals are
 * worked out from its lines (net, VAT by rate, gross), which a mapping's
 * one-value functions cannot do, and the template is ours, so its rules
 * can be exact. What is wrong is said by row, in words, for the preview
 * and for the problems file.
 */

export const BATCH_MAX_INVOICES = 500;

export const TEMPLATE_COLUMNS = [
  { name: "invoice_number", required: true, what: "the supplier's invoice number" },
  { name: "issue_date", required: true, what: "the invoice date, as 2026-09-30" },
  { name: "due_date", required: false, what: "when it is due, as 2026-10-30" },
  { name: "currency", required: true, what: "EUR, GBP, USD and so on" },
  { name: "supplier_name", required: false, what: "the supplier's name (or supplier_vat)" },
  { name: "supplier_vat", required: false, what: "the supplier's VAT number (or supplier_name)" },
  { name: "purchase_order", required: false, what: "your order number" },
  { name: "buyer_reference", required: false, what: "your reference" },
  { name: "line_description", required: true, what: "what the line is for" },
  { name: "quantity", required: true, what: "how many, with a dot for decimals" },
  { name: "unit", required: false, what: "a unit code such as C62 (each) or HUR (hour); C62 if empty" },
  { name: "unit_price", required: true, what: "the price of one, before VAT, with a dot" },
  { name: "vat_rate", required: true, what: "the VAT rate in percent: 20, 19, 7, 0" },
  { name: "line_net", required: false, what: "the line before VAT; must be quantity × unit_price if given" },
  { name: "notes", required: false, what: "a note on the invoice" },
] as const;

type Column = (typeof TEMPLATE_COLUMNS)[number]["name"];

/** The template, as a file to download: the header and two example lines of one invoice. */
export function templateCsv(): string {
  const header = TEMPLATE_COLUMNS.map((c) => c.name).join(",");
  const rows = [
    "INV-1001,2026-09-30,2026-10-30,GBP,Brightwell Supplies,GB123456789,PO-4471,,Office chairs,4,C62,120.00,20,480.00,",
    "INV-1001,2026-09-30,2026-10-30,GBP,Brightwell Supplies,GB123456789,PO-4471,,Delivery,1,C62,25.00,20,25.00,",
  ];
  return [header, ...rows].join("\r\n") + "\r\n";
}

export interface BatchProblem {
  /** The file's line, counting the header as line 1; absent for the whole file. */
  row?: number;
  text: string;
}

export interface BatchInvoice {
  /** Invoice number and supplier: what makes rows one invoice. */
  key: string;
  number: string;
  supplier: string | null;
  date: string | null;
  currency: string | null;
  total: number | null;
  rows: number[];
  facts: InvoiceFacts;
  lines: Array<InvoiceFacts & { lineNumber: number }>;
  problems: BatchProblem[];
  en16931: En16931Result | null;
}

export interface BatchRead {
  invoices: BatchInvoice[];
  /** What is wrong with the file as a whole: nothing in it can be used. */
  problems: BatchProblem[];
  rows: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: string) => ISO_DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** A number as the template writes it: digits, an optional minus, a dot for decimals. */
function numberOf(v: string): number | null {
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null;
}

/** Reads a batch file in the VibeFinance template. Never throws; everything wrong is a problem. */
export function readTemplateBatch(text: string): BatchRead {
  const delimiter = detectDelimiter(text) ?? ",";
  const rows = parseCsv(text, delimiter);
  if (rows.length === 0) return { invoices: [], problems: [{ text: "The file is empty." }], rows: 0 };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = new Map<string, number>(header.map((h, i) => [h, i]));
  const missing: string[] = TEMPLATE_COLUMNS.filter((c) => c.required && !col.has(c.name)).map((c) => c.name);
  if (!col.has("supplier_name") && !col.has("supplier_vat")) missing.push("supplier_name or supplier_vat");
  if (missing.length > 0) {
    return {
      invoices: [],
      problems: [{ row: 1, text: `The file has no column ${missing.join(", ")}. Download the template to see the columns.` }],
      rows: rows.length - 1,
    };
  }
  const cell = (row: string[], name: Column) => {
    const i = col.get(name);
    return i === undefined ? "" : (row[i] ?? "").trim();
  };

  const byKey = new Map<string, BatchInvoice & { firstValues: Record<string, { value: string; row: number }> }>();
  const loose: BatchInvoice[] = [];
  let dataRows = 0;
  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    if (row.every((c) => c.trim() === "")) return;
    dataRows += 1;
    const number = cell(row, "invoice_number");
    const supplierName = cell(row, "supplier_name");
    const supplierVat = cell(row, "supplier_vat");
    if (number === "") {
      loose.push({
        key: `row-${line}`,
        number: "",
        supplier: supplierName || supplierVat || null,
        date: null,
        currency: null,
        total: null,
        rows: [line],
        facts: {},
        lines: [],
        problems: [{ row: line, text: `Row ${line}: no invoice number` }],
        en16931: null,
      });
      return;
    }
    const supplierKey = (supplierVat || supplierName).toLowerCase().replace(/\s+/g, "");
    const key = `${number}|${supplierKey}`;
    const invoice =
      byKey.get(key) ??
      {
        key,
        number,
        supplier: supplierName || supplierVat || null,
        date: null,
        currency: null,
        total: null,
        rows: [],
        facts: {},
        lines: [],
        problems: [],
        en16931: null,
        firstValues: {},
      };
    byKey.set(key, invoice);
    invoice.rows.push(line);
    const problem = (text: string) => invoice.problems.push({ row: line, text: `Row ${line}: ${text}` });

    // Whole-invoice columns: said once, and the same on every row that says them.
    for (const name of ["issue_date", "due_date", "currency", "supplier_name", "supplier_vat", "purchase_order", "buyer_reference", "notes"] as const) {
      const value = cell(row, name);
      if (value === "") continue;
      const first = invoice.firstValues[name];
      if (!first) invoice.firstValues[name] = { value, row: line };
      else if (first.value !== value) problem(`${name} is ${value}, but row ${first.row} says ${first.value}`);
    }
    if (supplierName === "" && supplierVat === "") problem("no supplier_name or supplier_vat");
    const issue = cell(row, "issue_date");
    if (issue !== "" && !isDate(issue)) problem(`issue_date "${issue}" is not a date written as 2026-09-30`);
    const due = cell(row, "due_date");
    if (due !== "" && !isDate(due)) problem(`due_date "${due}" is not a date written as 2026-09-30`);
    const currency = cell(row, "currency");
    if (currency !== "" && !/^[A-Z]{3}$/.test(currency)) problem(`currency "${currency}" is not a three-letter code such as EUR`);

    const description = cell(row, "line_description");
    if (description === "") problem("no line_description");
    const qtyText = cell(row, "quantity");
    const priceText = cell(row, "unit_price");
    const rateText = cell(row, "vat_rate");
    const qty = numberOf(qtyText);
    const price = numberOf(priceText);
    const rate = numberOf(rateText);
    if (qty === null) problem(qtyText === "" ? "no quantity" : `quantity "${qtyText}" is not a number written with a dot`);
    if (price === null) problem(priceText === "" ? "no unit_price" : `unit_price "${priceText}" is not a number written with a dot`);
    if (rate === null) problem(rateText === "" ? "no VAT rate" : `vat_rate "${rateText}" is not a number written with a dot`);
    else if (rate < 0 || rate > 100) problem(`vat_rate ${rateText} is not a percentage from 0 to 100`);
    if (qty === null || price === null || rate === null) return;
    const net = round2(qty * price);
    const netText = cell(row, "line_net");
    if (netText !== "") {
      const given = numberOf(netText);
      if (given === null) problem(`line_net "${netText}" is not a number written with a dot`);
      else if (Math.abs(given - net) > 0.01) problem(`line_net ${netText} is not quantity × unit_price (${net.toFixed(2)})`);
    }
    const lineNumber = invoice.lines.length + 1;
    invoice.lines.push({
      lineNumber,
      "BT-126": String(lineNumber),
      "BT-153": description,
      "BT-129": qty,
      "BT-130": cell(row, "unit") || "C62",
      "BT-146": price,
      "BT-131": net,
      "BT-151": rate === 0 ? "Z" : "S",
      "BT-152": rate,
    });
  });

  const invoices: BatchInvoice[] = [];
  for (const invoice of byKey.values()) {
    const v = (name: string) => invoice.firstValues[name]?.value;
    if (!v("issue_date")) invoice.problems.push({ row: invoice.rows[0], text: `Row ${invoice.rows[0]}: no issue_date` });
    if (!v("currency")) invoice.problems.push({ row: invoice.rows[0], text: `Row ${invoice.rows[0]}: no currency` });
    const net = round2(invoice.lines.reduce((s, l) => s + (l["BT-131"] as number), 0));
    // VAT by rate, as an invoice states it: each rate's base times its rate, rounded once.
    const byRate = new Map<number, number>();
    for (const l of invoice.lines) byRate.set(l["BT-152"] as number, (byRate.get(l["BT-152"] as number) ?? 0) + (l["BT-131"] as number));
    const vat = round2([...byRate].reduce((s, [rate, base]) => s + round2((base * rate) / 100), 0));
    const gross = round2(net + vat);
    const facts: InvoiceFacts = {
      "BT-1": invoice.number,
      "BT-3": "380",
      ...(v("issue_date") ? { "BT-2": v("issue_date") } : {}),
      ...(v("due_date") ? { "BT-9": v("due_date") } : {}),
      ...(v("currency") ? { "BT-5": v("currency") } : {}),
      ...(v("buyer_reference") ? { "BT-10": v("buyer_reference") } : {}),
      ...(v("purchase_order") ? { "BT-13": v("purchase_order") } : {}),
      ...(v("notes") ? { "BT-22": v("notes") } : {}),
      ...(v("supplier_name") ? { "BT-27": v("supplier_name") } : {}),
      ...(v("supplier_vat") ? { "BT-31": v("supplier_vat") } : {}),
      "BT-106": net,
      "BT-109": net,
      "BT-110": vat,
      "BT-112": gross,
      "BT-115": gross,
    };
    const { firstValues: _unused, ...plain } = invoice;
    void _unused;
    invoices.push({
      ...plain,
      date: v("issue_date") ?? null,
      currency: v("currency") ?? null,
      total: invoice.lines.length > 0 ? gross : null,
      facts,
      en16931: invoice.problems.length === 0 ? checkEn16931(facts, invoice.lines, { sellerAddress: false, buyerAddress: false }, { xrechnung: false, mapped: true }) : null,
    });
  }
  const all = [...invoices, ...loose];
  const problems: BatchProblem[] = [];
  if (dataRows === 0) problems.push({ text: "The file has column names and no rows." });
  if (all.length > BATCH_MAX_INVOICES) {
    problems.push({ text: `The file holds ${all.length} invoices. At most ${BATCH_MAX_INVOICES} are read at once: split it and upload each part.` });
  }
  return { invoices: all, problems, rows: dataRows };
}

/** The problems as a CSV to fix from: each with its row, and the invoice it belongs to. */
export function problemsCsv(read: { invoices: Array<{ number: string; problems: BatchProblem[] }>; problems: BatchProblem[] }): string {
  const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ["row,invoice_number,problem"];
  for (const p of read.problems) lines.push([p.row ?? "", "", q(p.text)].join(","));
  for (const inv of read.invoices) for (const p of inv.problems) lines.push([p.row ?? "", q(inv.number), q(p.text)].join(","));
  return lines.join("\r\n") + "\r\n";
}
