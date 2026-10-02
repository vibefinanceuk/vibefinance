import { applyChain, listsInChain, validateChain, type FnContext, type FnValue, type FunctionStep } from "../ingestion/mapping-functions.js";

/**
 * **Outbound mapping — decision 0591**, slice 3 of the connector framework.
 *
 * How one VibeFinance invoice becomes the JSON a Destination's target
 * expects. The input is the VibeFinance invoice (`vibefinance.invoice.v1`,
 * 0585): the invoice, its lines, and each line's distributions. The output
 * is laid out by three groups of fields:
 *
 * - **invoice** fields, once;
 * - **line** fields, once per line, in an array named by the mapping;
 * - **distribution** fields, once per distribution, in an array inside each
 *   line (Oracle's `invoiceDistributions`) or one array on the invoice for
 *   every distribution (SAP's G/L account items).
 *
 * Each field has a target name (dotted for nesting, `supplier.id`), and
 * takes its value from a source in the invoice or a fixed value, changed
 * on the way by the mapping functions of supplier mappings (0561, 0568):
 * the same closed list, look-up lists included. A field may be required:
 * empty, it stops the invoice being sent, in words.
 *
 * The standard layout (`standardOutboundMapping`) gives exactly the
 * VibeFinance invoice JSON. A customer's own mapping starts as a copy of
 * it and is versioned like supplier mappings: a draft, tried on a real
 * invoice, then published.
 */

export type OutboundLevel = "invoice" | "line" | "distribution";

export interface OutboundField {
  target: string;
  /** A key of `OUTBOUND_SOURCES`, or null for a fixed value or one built from parts. */
  source: string | null;
  /** Decision 0606: true or false too, as SAP's TaxIsCalculatedAutomatically. */
  fixed?: string | number | boolean | null;
  /**
   * **Built from parts — decision 0605.** A pattern such as
   * `{company|Oracle company segments}-{distribution.costCentre}-{distribution.glCode}-0000-000`:
   * each `{source}` is that source's value, and `{source|list}` that value
   * looked up in a look-up list (by id in a Destination's mapping, by name
   * in a connector's definition). Oracle's account combination, SAP's
   * coding block. Any part empty, the field is empty.
   */
  built?: string;
  fx: FunctionStep[];
  /** What the person said, when the functions came from plain words. */
  say?: string;
  required?: boolean;
}

export interface OutboundMapping {
  format: "json";
  invoice: OutboundField[];
  lines: { name: string | null; fields: OutboundField[] };
  distributions: { name: string | null; place: "line" | "invoice"; fields: OutboundField[] };
  /** An empty value: left out, or written as null. */
  empty: "omit" | "null";
}

/** The VibeFinance invoice, version 1 (0585): what an outbound mapping reads. */
export interface VfInvoiceDistribution {
  splitRow: number | null;
  netAmount: number | null;
  costCentre: string | null;
  project: string | null;
  commodityCode: string | null;
  glCode: string | null;
}
export interface VfInvoiceLine {
  lineNumber: number | null;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  poLine: string | null;
  vatCategory: string | null;
  vatRate: number | null;
  netAmount: number;
  distributions: VfInvoiceDistribution[];
}
export interface VfInvoice {
  schema: string;
  id: string;
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  currency: string | null;
  company: string | null;
  supplier: { erpId: string | null; site: string | null; name: string | null; vatId: string | null };
  purchaseOrder: string | null;
  totals: { net: number | null; vat: number | null; total: number | null };
  lines: VfInvoiceLine[];
  /** Decision 0606: the day it is laid out to be sent (ISO); not in the standard layout. */
  sentOn?: string;
}

/** What an outbound mapping can read, at which level. Keys are paths in the VibeFinance invoice. */
export const OUTBOUND_SOURCES: ReadonlyArray<{ key: string; level: OutboundLevel }> = [
  { key: "id", level: "invoice" },
  // Decision 0606: the day it is sent, as a posting date.
  { key: "sentOn", level: "invoice" },
  { key: "invoiceNumber", level: "invoice" },
  { key: "issueDate", level: "invoice" },
  { key: "dueDate", level: "invoice" },
  { key: "currency", level: "invoice" },
  { key: "company", level: "invoice" },
  { key: "supplier.erpId", level: "invoice" },
  { key: "supplier.site", level: "invoice" },
  { key: "supplier.name", level: "invoice" },
  { key: "supplier.vatId", level: "invoice" },
  { key: "purchaseOrder", level: "invoice" },
  { key: "totals.net", level: "invoice" },
  { key: "totals.vat", level: "invoice" },
  { key: "totals.total", level: "invoice" },
  { key: "line.lineNumber", level: "line" },
  { key: "line.description", level: "line" },
  { key: "line.quantity", level: "line" },
  { key: "line.unit", level: "line" },
  { key: "line.poLine", level: "line" },
  { key: "line.vatCategory", level: "line" },
  { key: "line.vatRate", level: "line" },
  { key: "line.netAmount", level: "line" },
  { key: "distribution.sequence", level: "distribution" },
  // Decision 0605: 1, 2, … within each line, as Oracle numbers a line's distributions.
  { key: "distribution.numberInLine", level: "distribution" },
  { key: "distribution.splitRow", level: "distribution" },
  { key: "distribution.netAmount", level: "distribution" },
  { key: "distribution.costCentre", level: "distribution" },
  { key: "distribution.project", level: "distribution" },
  { key: "distribution.commodityCode", level: "distribution" },
  { key: "distribution.glCode", level: "distribution" },
];

const LEVEL_RANK: Record<OutboundLevel, number> = { invoice: 0, line: 1, distribution: 2 };
export const sourceLevel = (key: string): OutboundLevel | null => OUTBOUND_SOURCES.find((s) => s.key === key)?.level ?? null;
/** Whether a field at this level may read this source: its own level, or one above it. */
export const sourceAllowed = (key: string, level: OutboundLevel) => {
  const l = sourceLevel(key);
  return l !== null && LEVEL_RANK[l] <= LEVEL_RANK[level];
};

export const MAX_FIELDS = 200;
const SEGMENT = /^[A-Za-z_$@][A-Za-z0-9_\-$@]{0,63}$/;
/** A target name: up to six dotted segments of letters, digits, _ - $ @. */
export const validTarget = (name: string) => {
  const parts = name.split(".");
  return parts.length <= 6 && parts.every((p) => SEGMENT.test(p));
};

/** The standard layout: exactly the VibeFinance invoice JSON (0585). */
export function standardOutboundMapping(): OutboundMapping {
  const f = (target: string, source: string): OutboundField => ({ target, source, fx: [] });
  return {
    format: "json",
    invoice: [
      { target: "schema", source: null, fixed: "vibefinance.invoice.v1", fx: [] },
      f("id", "id"),
      f("invoiceNumber", "invoiceNumber"),
      f("issueDate", "issueDate"),
      f("dueDate", "dueDate"),
      f("currency", "currency"),
      f("company", "company"),
      f("supplier.erpId", "supplier.erpId"),
      f("supplier.site", "supplier.site"),
      f("supplier.name", "supplier.name"),
      f("supplier.vatId", "supplier.vatId"),
      f("purchaseOrder", "purchaseOrder"),
      f("totals.net", "totals.net"),
      f("totals.vat", "totals.vat"),
      f("totals.total", "totals.total"),
    ],
    lines: {
      name: "lines",
      fields: ["lineNumber", "description", "quantity", "unit", "poLine", "vatCategory", "vatRate", "netAmount"].map((k) => f(k, `line.${k}`)),
    },
    distributions: {
      name: "distributions",
      place: "line",
      fields: ["splitRow", "netAmount", "costCentre", "project", "commodityCode", "glCode"].map((k) => f(k, `distribution.${k}`)),
    },
    empty: "null",
  };
}

/** Why the targets of one object clash: the same name twice, or `a` beside `a.b`. */
function clash(names: string[]): string | null {
  const seen = new Set<string>();
  for (const n of names) {
    if (seen.has(n)) return `"${n}" is named twice`;
    seen.add(n);
  }
  for (const n of names) {
    for (const m of names) if (m !== n && m.startsWith(`${n}.`)) return `"${n}" cannot hold a value and also "${m}"`;
  }
  return null;
}

/** The parts of a built field: each `{source}` or `{source|list}`. Decision 0605. */
export function builtParts(pattern: string): Array<{ source: string; list: string | null }> {
  return [...pattern.matchAll(/\{([^{}|]+)(?:\|([^{}]+))?\}/g)].map((m) => ({ source: m[1].trim(), list: m[2] ? m[2].trim() : null }));
}
export const MAX_BUILT = 300;

/** Why a built pattern cannot be used at this level, or null. */
function builtProblem(target: string, pattern: unknown, level: OutboundLevel): string | null {
  if (typeof pattern !== "string" || pattern.trim() === "" || pattern.length > MAX_BUILT) return `${target}: a pattern of up to ${MAX_BUILT} characters`;
  const parts = builtParts(pattern);
  if (parts.length === 0) return `${target}: the pattern names no part, such as {distribution.glCode}`;
  if (/[{}]/.test(pattern.replace(/\{[^{}|]+(?:\|[^{}]+)?\}/g, ""))) return `${target}: a brace that opens no part`;
  for (const p of parts) {
    if (sourceLevel(p.source) === null) return `${target}: "${p.source}" is not part of the VibeFinance invoice`;
    if (!sourceAllowed(p.source, level)) return `${target} is once per ${level}, and cannot read ${p.source}, which is once per ${sourceLevel(p.source)}`;
    if (p.list !== null && (p.list === "" || p.list.length > 120)) return `${target}: name the look-up list for ${p.source}`;
  }
  return null;
}

/** Why an outbound mapping cannot be stored, or null where it can. */
export function validateOutboundMapping(input: unknown): string | null {
  const d = input as OutboundMapping;
  if (!d || typeof d !== "object") return "a mapping is an object";
  if (d.format !== "json") return "the format is json";
  if (d.empty !== "omit" && d.empty !== "null") return "empty values are omit or null";
  if (!Array.isArray(d.invoice) || !d.lines || !Array.isArray(d.lines.fields) || !d.distributions || !Array.isArray(d.distributions.fields)) {
    return "a mapping has invoice, lines and distributions fields";
  }
  if (d.distributions.place !== "line" && d.distributions.place !== "invoice") return "distributions are placed in each line or on the invoice";
  const groups: Array<[OutboundLevel, OutboundField[]]> = [
    ["invoice", d.invoice],
    ["line", d.lines.fields],
    ["distribution", d.distributions.fields],
  ];
  for (const [level, fields] of groups) {
    if (fields.length > MAX_FIELDS) return `at most ${MAX_FIELDS} fields at each level`;
    for (const f of fields) {
      if (!f || typeof f.target !== "string" || !validTarget(f.target)) return `"${String(f?.target)}" is not a name a field can have`;
      if (f.built !== undefined) {
        if (f.source !== null) return `${f.target} is built from parts, so it has no single source`;
        const p = builtProblem(f.target, f.built, level);
        if (p) return p;
      } else if (f.source === null) {
        if (f.fixed === undefined || f.fixed === null || (typeof f.fixed !== "string" && typeof f.fixed !== "number" && typeof f.fixed !== "boolean")) {
          return `${f.target} needs a source or a fixed value`;
        }
      } else if (typeof f.source !== "string" || sourceLevel(f.source) === null) {
        return `"${String(f.source)}" is not part of the VibeFinance invoice`;
      } else if (!sourceAllowed(f.source, level)) {
        return `${f.target} is once per ${level}, and cannot read ${f.source}, which is once per ${sourceLevel(f.source)}`;
      }
      const chain = validateChain(f.fx ?? []);
      if (chain) return `${f.target}: ${chain}`;
    }
  }
  const linesUsed = d.lines.fields.length > 0 || (d.distributions.place === "line" && d.distributions.fields.length > 0);
  const distsUsed = d.distributions.fields.length > 0;
  if (linesUsed && (!d.lines.name || !validTarget(d.lines.name))) return "name the lines' array";
  if (distsUsed && (!d.distributions.name || !validTarget(d.distributions.name))) return "name the distributions' array";
  const invoiceNames = d.invoice.map((f) => f.target);
  if (linesUsed) invoiceNames.push(d.lines.name as string);
  if (distsUsed && d.distributions.place === "invoice") invoiceNames.push(d.distributions.name as string);
  const lineNames = d.lines.fields.map((f) => f.target);
  if (distsUsed && d.distributions.place === "line") lineNames.push(d.distributions.name as string);
  return clash(invoiceNames) ?? clash(lineNames) ?? clash(d.distributions.fields.map((f) => f.target));
}

export interface OutboundProblem {
  /** Where in the output, such as `lines[2].amount`. */
  at: string;
  source: string | null;
  value: FnValue;
  reason: string;
}

export interface AppliedOutbound {
  body: Record<string, unknown>;
  problems: OutboundProblem[];
}

function read(obj: unknown, path: string): FnValue {
  let node: unknown = obj;
  for (const p of path.split(".")) {
    if (node === null || typeof node !== "object") return null;
    node = (node as Record<string, unknown>)[p];
  }
  return node === undefined || node === null ? null : typeof node === "number" ? node : String(node);
}

function setAt(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let node = obj;
  for (const p of parts.slice(0, -1)) {
    if (!node[p] || typeof node[p] !== "object" || Array.isArray(node[p])) node[p] = {};
    node = node[p] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
}

interface Scope {
  invoice: VfInvoice;
  line?: VfInvoiceLine;
  distribution?: VfInvoiceDistribution & { sequence: number; numberInLine?: number };
}

function readSource(scope: Scope, key: string): FnValue {
  if (key.startsWith("line.")) return read(scope.line, key.slice(5));
  if (key.startsWith("distribution.")) return read(scope.distribution, key.slice(13));
  return read(scope.invoice, key);
}

/** A built field's value: its parts read, looked up where a list is named, and put in place. Any part empty, it is empty. */
function buildValue(pattern: string, scope: Scope, ctx?: FnContext): { value: FnValue } | { value: FnValue; reason: string } {
  let empty = false;
  let failed: { value: FnValue; reason: string } | null = null;
  const value = pattern.replace(/\{([^{}|]+)(?:\|([^{}]+))?\}/g, (_m, source: string, list?: string) => {
    let v = readSource(scope, source.trim());
    if (v === null || String(v) === "") {
      empty = true;
      return "";
    }
    if (list && !failed) {
      const r = applyChain([{ fn: "look_up", args: { list: list.trim(), otherwise: "refuse" } }], v, ctx);
      if (!r.ok) failed = { value: v, reason: r.reason };
      else v = r.value;
    }
    return String(v ?? "");
  });
  if (failed) return failed;
  return { value: empty ? null : value };
}

function fill(out: Record<string, unknown>, fields: OutboundField[], scope: Scope, where: string, mapping: OutboundMapping, problems: OutboundProblem[], ctx?: FnContext) {
  for (const f of fields) {
    const at = where ? `${where}.${f.target}` : f.target;
    let raw: FnValue;
    if (f.built !== undefined) {
      const built = buildValue(f.built, scope, ctx);
      if ("reason" in built) {
        problems.push({ at, source: null, value: built.value, reason: built.reason });
        continue;
      }
      raw = built.value;
    } else {
      raw = f.source === null ? ((f.fixed ?? null) as FnValue) : readSource(scope, f.source);
    }
    let value: FnValue = raw;
    // As inbound (0561): an empty value goes through the functions only where one gives a default.
    const hasDefault = f.fx.some((s) => s.fn === "always" || s.fn === "if_empty");
    if (f.fx.length > 0 && (raw !== null || hasDefault)) {
      const r = applyChain(f.fx, raw, ctx);
      if (!r.ok) {
        problems.push({ at, source: f.source, value: raw, reason: r.reason });
        continue;
      }
      value = r.value;
    }
    const empty = value === null || value === "";
    if (empty && f.required) {
      problems.push({ at, source: f.source, value: raw, reason: "is required, and is empty" });
      continue;
    }
    if (empty && mapping.empty === "omit") continue;
    setAt(out, f.target, empty ? null : value);
  }
}

/** One invoice laid out by an outbound mapping, with anything it could not lay out in words. */
export function applyOutboundMapping(mapping: OutboundMapping, invoice: VfInvoice, ctx?: FnContext): AppliedOutbound {
  const problems: OutboundProblem[] = [];
  const body: Record<string, unknown> = {};
  fill(body, mapping.invoice, { invoice }, "", mapping, problems, ctx);
  const dists = mapping.distributions;
  const linesUsed = mapping.lines.fields.length > 0 || (dists.place === "line" && dists.fields.length > 0);
  const distsUsed = dists.fields.length > 0;
  const lines: Record<string, unknown>[] = [];
  const atInvoice: Record<string, unknown>[] = [];
  let sequence = 0;
  invoice.lines.forEach((line, i) => {
    const lineOut: Record<string, unknown> = {};
    const lineAt = `${mapping.lines.name ?? "lines"}[${i + 1}]`;
    fill(lineOut, mapping.lines.fields, { invoice, line }, lineAt, mapping, problems, ctx);
    const inLine: Record<string, unknown>[] = [];
    line.distributions.forEach((d, j) => {
      sequence += 1;
      if (!distsUsed) return;
      const distOut: Record<string, unknown> = {};
      const distAt = dists.place === "line" ? `${lineAt}.${dists.name}[${j + 1}]` : `${dists.name}[${sequence}]`;
      fill(distOut, dists.fields, { invoice, line, distribution: { ...d, sequence, numberInLine: j + 1 } }, distAt, mapping, problems, ctx);
      (dists.place === "line" ? inLine : atInvoice).push(distOut);
    });
    if (distsUsed && dists.place === "line") setAt(lineOut, dists.name as string, inLine);
    lines.push(lineOut);
  });
  if (linesUsed) setAt(body, mapping.lines.name as string, lines);
  if (distsUsed && dists.place === "invoice") setAt(body, dists.name as string, atInvoice);
  return { body, problems };
}

/** Every value a source holds in this invoice: the worked examples for a function. */
export function outboundSamples(invoice: VfInvoice, key: string): string[] {
  const level = sourceLevel(key);
  const values: FnValue[] = [];
  if (level === "invoice") values.push(read(invoice, key));
  let sequence = 0;
  for (const line of invoice.lines) {
    if (level === "line") values.push(readSource({ invoice, line }, key));
    line.distributions.forEach((d, j) => {
      sequence += 1;
      if (level === "distribution") values.push(readSource({ invoice, line, distribution: { ...d, sequence, numberInLine: j + 1 } }, key));
    });
  }
  return [...new Set(values.filter((v) => v !== null).map(String))].slice(0, 20);
}

/** The look-up lists a mapping names, by id: what a caller loads before running it. */
export function listsInOutbound(mapping: OutboundMapping): string[] {
  return [
    ...new Set(
      [...mapping.invoice, ...mapping.lines.fields, ...mapping.distributions.fields].flatMap((f) => [
        ...listsInChain(f.fx),
        // Decision 0605: the lists a built field's parts are looked up in.
        ...(f.built ? builtParts(f.built).flatMap((p) => (p.list ? [p.list] : [])) : []),
      ])
    ),
  ];
}
