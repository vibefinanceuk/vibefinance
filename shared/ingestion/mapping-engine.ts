import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { InvoiceFacts } from "../interpreter/types.js";
import { INVOICE_LINE_FIELDS } from "../interpreter/vocabulary.js";
import { checkEn16931, type En16931Result } from "./en16931-rules.js";
import { applyChain, validateChain, type FnValue, type FunctionStep } from "./mapping-functions.js";

/**
 * A supplier's own XML, read through a mapping — decision 0561.
 *
 * Some suppliers send XML that is neither UBL nor CII: their own
 * `<Rechnung>`, with their own element names. A **mapping** says, line by
 * line, which element becomes which EN 16931 Business Term, and what
 * function (if any) changes the value on the way. This module is the two
 * things the editor and intake need from one:
 *
 * - `describeXml`: what a document contains — every element, where it is,
 *   a sample value, and which groups repeat (the invoice lines) — for the
 *   editor's left-hand column;
 * - `applyMapping`: the facts and lines a mapping makes of a document, and
 *   every value it could not turn into what the Business Term needs, in
 *   words.
 *
 * **Paths** are element names from the root, without namespace prefixes:
 * `Rechnung/Kopf/Datum`; an attribute is `@name` on the end. A line's
 * sources are relative to the repeating group (`linesPath`): `Menge`.
 *
 * Values are read as the text written, never parsed by the XML library:
 * `00123` stays `00123` and `29.09.2026` is not taken for a number.
 */

export interface MappingLine {
  /** An EN 16931 Business Term from the rule vocabulary. */
  target: string;
  /** Where the value comes from; null for a value given by a function (`always`). */
  source: string | null;
  /** The function chain, possibly empty. */
  fx: FunctionStep[];
  /** What the person said the function should do, kept beside it. */
  say?: string;
  /** Who drew the line: a person, or (from slice 4) AI. */
  origin?: "person" | "ai";
}

export interface MappingDefinition {
  /** The document's root element, which is how a mapping is recognised. */
  root: string;
  /** The repeating group that holds the invoice lines, or null. */
  linesPath: string | null;
  lines: MappingLine[];
}

export interface DescribedElement {
  /** From the root for a header element; relative to `linesPath` for a line element. */
  path: string;
  sample: string;
  /** How many times it occurs in the document. */
  count: number;
}

export interface DescribedXml {
  root: string;
  /** Groups that repeat, most likely to be the lines first. */
  repeating: string[];
  /** Every group holding values of its own: what a person may choose as the lines. */
  groups: string[];
  /** Every element with a value, from the root. */
  elements: DescribedElement[];
}

export class MappingXmlError extends Error {}

/** Business Terms the mapping may target, and what each must end up as. */
export const MAPPING_TARGETS: Record<string, "text" | "number" | "date"> = {
  "BT-1": "text", "BT-2": "date", "BT-3": "text", "BT-5": "text", "BT-9": "date", "BT-10": "text",
  "BT-11": "text", "BT-13": "text", "BT-20": "text", "BT-27": "text", "BT-31": "text", "BT-34": "text",
  "BT-40": "text", "BT-44": "text", "BT-48": "text", "BT-49": "text", "BT-55": "text",
  "BT-106": "number", "BT-109": "number", "BT-110": "number", "BT-112": "number", "BT-115": "number",
  "BT-126": "text", "BT-127": "text", "BT-129": "number", "BT-130": "text", "BT-131": "number",
  "BT-132": "text", "BT-133": "text", "BT-146": "number", "BT-151": "text", "BT-152": "number",
  "BT-153": "text", "BT-154": "text",
};

export const isLineTarget = (target: string) => INVOICE_LINE_FIELDS.includes(target);

type Tree = Record<string, unknown>;

function parse(xml: string): { root: string; node: unknown } {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new MappingXmlError(`not well-formed XML: ${valid.err.msg}`);
  const parsed = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
  }).parse(xml) as Tree;
  const root = Object.keys(parsed).find((k) => !k.startsWith("?") && !k.startsWith("@_"));
  if (!root) throw new MappingXmlError("the document has no root element");
  return { root, node: parsed[root] };
}

function textOf(node: unknown): string | null {
  if (node === undefined || node === null) return null;
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return textOf(node[0]);
  if (typeof node === "object" && "#text" in (node as Tree)) return textOf((node as Tree)["#text"]);
  return null;
}

/** Every node a path reaches, following repeats. */
function nodesAt(node: unknown, segments: string[]): unknown[] {
  let current: unknown[] = [node];
  for (const segment of segments) {
    const next: unknown[] = [];
    for (const n of current) {
      if (n === null || typeof n !== "object" || Array.isArray(n)) continue;
      const key = segment.startsWith("@") ? `@_${segment.slice(1)}` : segment;
      const child = (n as Tree)[key];
      if (child === undefined) continue;
      if (Array.isArray(child)) next.push(...child);
      else next.push(child);
    }
    current = next;
  }
  return current;
}

const split = (path: string) => path.split("/").filter(Boolean);

/** The first value at a path under a node, or null where there is none. */
function valueAt(node: unknown, path: string): string | null {
  const [first] = nodesAt(node, split(path));
  const v = textOf(first);
  return v === null || v === "" ? null : v;
}

export function describeXml(xml: string): DescribedXml {
  const { root, node } = parse(xml);
  const elements = new Map<string, DescribedElement>();
  const repeating = new Map<string, number>();

  const walk = (n: unknown, path: string) => {
    if (n === null || n === undefined) return;
    if (Array.isArray(n)) {
      repeating.set(path, Math.max(repeating.get(path) ?? 0, n.length));
      for (const item of n) walk(item, path);
      return;
    }
    if (typeof n !== "object") {
      const v = String(n);
      const e = elements.get(path);
      if (e) e.count++;
      else elements.set(path, { path, sample: v, count: 1 });
      return;
    }
    for (const [key, child] of Object.entries(n as Tree)) {
      if (key === "#text") {
        walk(child, path);
      } else if (key.startsWith("@_")) {
        if (key.startsWith("@_xmlns")) continue;
        walk(child, `${path}/@${key.slice(2)}`);
      } else {
        walk(child, `${path}/${key}`);
      }
    }
  };
  walk(node, root);

  // A group that repeats and holds several values of its own is most
  // likely the lines; the one with the most such values first.
  const values = [...elements.keys()];
  const containers = [...new Set(values.map((p) => p.split("/").slice(0, -1).join("/")))].filter((g) => g !== root && g !== "");
  const byOwnValues = (list: string[]) =>
    list
      .map((g) => ({ g, own: values.filter((p) => p.startsWith(`${g}/`)).length }))
      .filter((x) => x.own >= 2)
      .sort((a, b) => b.own - a.own || a.g.length - b.g.length)
      .map((x) => x.g);
  // An invoice with one line has nothing that repeats; its line is then
  // recognised by what such groups are usually called.
  const repeats = byOwnValues([...repeating.keys()]);
  const named = byOwnValues(containers.filter((g) => /(^|\/)(pos|position|posten|zeile|artikel|line|lineitem|item|row)[^/]*$/i.test(g)));

  return {
    root,
    repeating: repeats.length > 0 ? repeats : named,
    groups: containers,
    elements: [...elements.values()],
  };
}

/** Every value at an absolute path, in document order: a function's worked examples. */
export function valuesAt(xml: string, path: string): string[] {
  const { root, node } = parse(xml);
  const segments = split(path);
  if (segments[0] !== root) return [];
  return nodesAt(node, segments.slice(1))
    .map((n) => textOf(n))
    .filter((v): v is string => v !== null && v !== "");
}

/** Why a definition cannot be saved, or null where it can. */
export function validateMapping(def: unknown): string | null {
  const d = def as MappingDefinition;
  if (!d || typeof d !== "object") return "a mapping is an object";
  if (typeof d.root !== "string" || d.root.trim() === "") return "a mapping names the document's root element";
  if (d.linesPath !== null && typeof d.linesPath !== "string") return "linesPath is a path or null";
  if (!Array.isArray(d.lines)) return "a mapping has a list of lines";
  const seen = new Set<string>();
  for (const line of d.lines) {
    if (!line || typeof line.target !== "string" || !(line.target in MAPPING_TARGETS)) {
      return `"${String(line?.target)}" is not a Business Term a mapping can fill`;
    }
    if (seen.has(line.target)) return `${line.target} is mapped twice`;
    seen.add(line.target);
    if (line.source !== null && typeof line.source !== "string") return `${line.target}'s source is a path or nothing`;
    if (isLineTarget(line.target) && d.linesPath === null && line.source !== null) {
      return `${line.target} is a line's; choose where the lines repeat first`;
    }
    const chainError = validateChain(line.fx ?? []);
    if (chainError) return `${line.target}: ${chainError}`;
    if (line.source === null && !(line.fx ?? []).some((s) => s.fn === "always")) {
      return `${line.target} has no source, so it needs a fixed value ("always")`;
    }
  }
  return null;
}

export interface MappingProblem {
  target: string;
  source: string | null;
  /** The value as the document wrote it. */
  value: string | null;
  reason: string;
  /** The line, for a line's term. */
  line?: number;
}

export interface AppliedMapping {
  facts: InvoiceFacts;
  lines: Array<InvoiceFacts & { lineNumber: number }>;
  /** Every value that could not be made into what its term needs. Empty is success. */
  problems: MappingProblem[];
  en16931: En16931Result;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function finish(
  line: MappingLine,
  raw: string | null,
  lineNumber: number | undefined
): { value?: string | number; problem?: MappingProblem } {
  const hasDefault = line.fx.some((s) => s.fn === "always" || s.fn === "if_empty");
  if (raw === null && !hasDefault) return {};
  const at = { target: line.target, source: line.source, value: raw, ...(lineNumber !== undefined ? { line: lineNumber } : {}) };
  const result = applyChain(line.fx, raw as FnValue);
  if (!result.ok) return { problem: { ...at, reason: result.reason } };
  let value = result.value;
  if (value === null || value === "") return {};
  const kind = MAPPING_TARGETS[line.target];
  if (kind === "number" && typeof value !== "number") {
    const n = Number(String(value).trim());
    if (String(value).trim() === "" || !Number.isFinite(n)) {
      return { problem: { ...at, reason: `"${value}" is not a number; a function such as "decimal comma" can read it` } };
    }
    value = n;
  }
  if (kind === "date" && !ISO.test(String(value))) {
    return { problem: { ...at, reason: `"${value}" is not a date; a function such as "read date" can read it` } };
  }
  if (kind === "text") value = String(value);
  return { value };
}

export function applyMapping(xml: string, def: MappingDefinition): AppliedMapping {
  const { root, node } = parse(xml);
  if (root !== def.root) {
    throw new MappingXmlError(`this document's root is <${root}>, and the mapping is for <${def.root}>`);
  }
  const facts: InvoiceFacts = {};
  const problems: MappingProblem[] = [];
  const rootPrefix = `${root}/`;
  const relative = (path: string) => (path.startsWith(rootPrefix) ? path.slice(rootPrefix.length) : path === root ? "" : path);

  for (const line of def.lines.filter((l) => !isLineTarget(l.target))) {
    const raw = line.source === null ? null : valueAt(node, relative(line.source));
    const { value, problem } = finish(line, raw, undefined);
    if (problem) problems.push(problem);
    else if (value !== undefined) facts[line.target] = value;
  }

  const lineDefs = def.lines.filter((l) => isLineTarget(l.target));
  const groups = def.linesPath ? nodesAt(node, split(relative(def.linesPath))) : [];
  const lines = groups.map((group, idx) => {
    const lineFacts: InvoiceFacts & { lineNumber: number } = { lineNumber: idx + 1 };
    for (const line of lineDefs) {
      const raw = line.source === null ? null : valueAt(group, line.source);
      const { value, problem } = finish(line, raw, idx + 1);
      if (problem) problems.push(problem);
      else if (value !== undefined) lineFacts[line.target] = value;
    }
    const id = Number(lineFacts["BT-126"]);
    if (Number.isInteger(id) && id > 0) lineFacts.lineNumber = id;
    return lineFacts;
  });

  const en16931 = checkEn16931(
    facts,
    lines,
    // A mapped document has no postal address group of its own to test;
    // a country code is what BR-09/BR-11 need, and stands in for it.
    { sellerAddress: facts["BT-40"] !== undefined, buyerAddress: facts["BT-55"] !== undefined },
    { xrechnung: false, mapped: true }
  );
  return { facts, lines, problems, en16931 };
}
