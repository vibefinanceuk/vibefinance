/**
 * A supplier's own CSV, read through a mapping — decision 0565.
 *
 * Phase 2, slice 3 starts with CSV because Dan chose it first. A supplier
 * that sends a CSV file has columns rather than elements, and one row per
 * invoice line, with the invoice's own values (its number, its date, its
 * totals) repeated on every row.
 *
 * **It is read as a small XML document, and nothing else changes.** The
 * CSV becomes
 *
 * ```xml
 * <CSV>
 *   <First><Rechnungsnr>88240</Rechnungsnr>...</First>   the first row
 *   <Row><Rechnungsnr>88240</Rechnungsnr>...</Row>       every row
 *   <Row>...</Row>
 * </CSV>
 * ```
 *
 * so the mapping engine, the editor, functions, Try, Publish and the
 * EN 16931 checks all work on it exactly as they do on a `<Rechnung>`:
 *
 * - a whole-invoice term reads a column from `CSV/First`, the first row;
 * - a line term reads a column from `CSV/Row`, which is where the lines
 *   repeat.
 *
 * **One invoice per file.** A file whose invoice number (BT-1) differs
 * between rows holds several invoices; `invoicesIn` says so, and intake
 * refuses it in words rather than read several invoices as one.
 *
 * **Read as written.** No value is parsed: `00088240` stays as it is, and
 * `45,50` needs the decimal comma function, as in XML.
 */

export type CsvDelimiter = ";" | "," | "\t" | "|";
export const CSV_DELIMITERS: readonly CsvDelimiter[] = [";", ",", "\t", "|"];

export interface CsvOptions {
  /** What separates the columns. */
  delimiter: CsvDelimiter;
  /** Whether the first row (after any skipped) holds the column names. */
  header: boolean;
  /** Lines at the top to ignore before the first row: a title, a blank line. */
  skip: number;
}

/** The root a CSV mapping is recognised by, and the virtual document's. */
export const CSV_ROOT = "CSV";
export const CSV_FIRST = "CSV/First";
export const CSV_ROWS = "CSV/Row";

export class CsvError extends Error {}

/**
 * Windows-1252, the other encoding a supplier's CSV arrives in: what Excel
 * saves "CSV" as on a German or British Windows machine. Only 0x80 to
 * 0x9F differ from Latin-1; the rest map to the same code point.
 */
const CP1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6,
  0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
  0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

/** The text of a file: UTF-8 where it is valid UTF-8, else Windows-1252. The BOM is dropped. */
export function decodeText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    let out = "";
    for (const b of bytes) out += String.fromCharCode(CP1252[b] ?? b);
    text = out;
  }
  return text.startsWith("﻿") ? text.slice(1) : text;
}

/** Rows of cells, honouring quotes, doubled quotes, and line breaks inside quotes. */
export function parseCsv(text: string, delimiter: CsvDelimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const end = () => {
    row.push(cell);
    cell = "";
  };
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += c;
      i++;
      continue;
    }
    if (c === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
      i++;
      continue;
    }
    if (c === delimiter) {
      end();
      i++;
      continue;
    }
    if (c === "\r" || c === "\n") {
      end();
      rows.push(row);
      row = [];
      i += c === "\r" && text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    cell += c;
    i++;
  }
  if (cell !== "" || row.length > 0) {
    end();
    rows.push(row);
  }
  // A line with nothing on it is not a row.
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/** The lines of the text, as the file has them, for skipping. */
function skipLines(text: string, skip: number): string {
  if (skip <= 0) return text;
  let at = 0;
  for (let n = 0; n < skip; n++) {
    const next = text.indexOf("\n", at);
    if (next === -1) return "";
    at = next + 1;
  }
  return text.slice(at);
}

/**
 * The separator a file uses: the one that splits its first rows into the
 * same number of columns, more than one, most often. Null where none does.
 */
export function detectDelimiter(text: string): CsvDelimiter | null {
  let best: { d: CsvDelimiter; cols: number } | null = null;
  for (const d of CSV_DELIMITERS) {
    const rows = parseCsv(text, d).slice(0, 10);
    if (rows.length === 0) continue;
    const cols = rows[0].length;
    if (cols < 2) continue;
    if (!rows.every((r) => r.length === cols)) continue;
    if (!best || cols > best.cols) best = { d, cols };
  }
  return best?.d ?? null;
}

const looksNumeric = (v: string) => /^[-+]?[\d.,\s]+$/.test(v.trim()) || /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$/.test(v.trim());

/**
 * How to read a file, guessed from it: the separator, and whether the
 * first row holds column names (no cell in it looks like a number or a
 * date, and every name is different). The editor lets a person change
 * both, and what lines to skip at the top.
 */
export function detectCsvOptions(text: string): CsvOptions {
  const delimiter = detectDelimiter(text) ?? ";";
  const [first] = parseCsv(text, delimiter);
  const names = (first ?? []).map((v) => v.trim());
  const header = names.length > 0 && names.every((v) => v !== "" && !looksNumeric(v)) && new Set(names).size === names.length;
  return { delimiter, header, skip: 0 };
}

/**
 * Whether bytes are a CSV file: text, not XML, and at least two rows that
 * one separator splits into the same number of columns (two or more).
 * Detection's own question, asked after PDF, XML and images.
 */
export function looksLikeCsv(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  // A NUL byte is binary, never text.
  if (bytes.slice(0, 4096).includes(0)) return false;
  const text = decodeText(bytes.slice(0, 64 * 1024));
  const head = text.trimStart();
  if (head.startsWith("<") || head.startsWith("%PDF") || head.startsWith("{")) return false;
  const d = detectDelimiter(text);
  return d !== null && parseCsv(text, d).length >= 2;
}

/** A column name as an element name: letters, digits, `_`, `-` and `.`, not starting with a digit. */
function elementName(raw: string, index: number, taken: Set<string>): string {
  let name = raw
    .trim()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}_.-]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  if (name === "") name = `Column${index + 1}`;
  if (!/^[\p{L}_]/u.test(name)) name = `C_${name}`;
  if (/^xml/i.test(name)) name = `C_${name}`;
  let unique = name;
  for (let n = 2; taken.has(unique); n++) unique = `${name}_${n}`;
  taken.add(unique);
  return unique;
}

const escapeXml = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface CsvAsXml {
  xml: string;
  /** Each column: its name as written, and its element name in the paths. */
  columns: Array<{ name: string; element: string }>;
  /** How many data rows. */
  rows: number;
}

/**
 * The CSV as the small document the mapping engine reads. An empty cell is
 * left out, so a term mapped from it is reported missing, as an empty XML
 * element is.
 */
export function csvToXml(text: string, options: CsvOptions): CsvAsXml {
  const rows = parseCsv(skipLines(text, options.skip), options.delimiter);
  if (rows.length === 0) throw new CsvError("the file has no rows");
  const width = Math.max(...rows.map((r) => r.length));
  const names = options.header ? rows[0] : [];
  const data = options.header ? rows.slice(1) : rows;
  if (data.length === 0) throw new CsvError("the file has column names and no rows");
  const taken = new Set<string>();
  const columns = Array.from({ length: width }, (_, i) => {
    const name = (names[i] ?? "").trim() || `Column ${i + 1}`;
    return { name, element: elementName(names[i] ?? "", i, taken) };
  });
  const rowXml = (tag: string, cells: string[]) =>
    `<${tag}>${columns
      .map((c, i) => {
        const v = (cells[i] ?? "").trim();
        return v === "" ? "" : `<${c.element}>${escapeXml(v)}</${c.element}>`;
      })
      .join("")}</${tag}>`;
  const xml = `<${CSV_ROOT}>${rowXml("First", data[0])}${data.map((r) => rowXml("Row", r)).join("")}</${CSV_ROOT}>`;
  return { xml, columns, rows: data.length };
}

/**
 * The distinct values a column holds across rows, for the one-invoice
 * check: several invoice numbers mean several invoices in one file.
 * `path` is a mapping source, `CSV/First/<column>` or `CSV/Row/<column>`.
 */
export function distinctInColumn(text: string, options: CsvOptions, path: string): string[] {
  const element = path.split("/").pop() ?? "";
  const index = csvToXml(text, options).columns.findIndex((c) => c.element === element);
  if (index === -1) return [];
  const rows = parseCsv(skipLines(text, options.skip), options.delimiter);
  const data = options.header ? rows.slice(1) : rows;
  return [...new Set(data.map((r) => (r[index] ?? "").trim()).filter((v) => v !== ""))];
}

/**
 * What the mapping engine reads for a file: a CSV mapping's file as its
 * small XML document, read with the mapping's own options (or, before
 * there are any, the ones guessed from the file); anything else as it is.
 */
export function mappableXml(text: string, def: { root: string; csv?: CsvOptions }): string {
  return def.root === CSV_ROOT ? csvToXml(text, def.csv ?? detectCsvOptions(text)).xml : text;
}

/** Why CSV options cannot be used, or null where they can. */
export function validateCsvOptions(options: unknown): string | null {
  const o = options as CsvOptions;
  if (!o || typeof o !== "object") return "CSV options are an object";
  if (!CSV_DELIMITERS.includes(o.delimiter)) return "the separator is one of ; , tab or |";
  if (typeof o.header !== "boolean") return "whether the first row holds column names is yes or no";
  if (!Number.isInteger(o.skip) || o.skip < 0 || o.skip > 50) return "lines to skip at the top is a whole number from 0 to 50";
  return null;
}
