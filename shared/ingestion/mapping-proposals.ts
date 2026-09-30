import { extractJson } from "../compiler/parse.js";
import type { CompilerModel } from "../compiler/types.js";
import type { InvoiceFacts } from "../interpreter/types.js";
import {
  applyMapping,
  isLineTarget,
  MAPPING_TARGETS,
  type DescribedXml,
  type MappingDefinition,
  type MappingLine,
} from "./mapping-engine.js";
import { applyChain, describeFunctions, validateChain, type FnContext, type FunctionStep } from "./mapping-functions.js";

/**
 * **AI proposing a mapping's lines, with a confidence — decision 0570.**
 *
 * Phase 2, slice 4, as Dan approved it in the mock-up: each proposed line
 * gets a confidence, based on **names, values, and whether the invoice
 * adds up**; the person applies everything at or above a threshold they
 * choose, and works on the rest, grouped as *you check*, *weak guesses*,
 * and *required, nothing found*.
 *
 * **The model proposes; our code scores.** The model is good at reading a
 * supplier's element names in any language and suggesting which Business
 * Term each becomes, and what function reads it. It is not asked how sure
 * it is: a model's own confidence is a number it writes, and cannot be
 * checked. The confidence here is computed, from three signals:
 *
 * - **Name** (`nameScore`): how well the element's name, and its group's,
 *   matches what that term is usually called, in English and German.
 * - **Value** (`valueScore`): what the sample's value becomes through the
 *   proposed functions, and whether that is the right kind of value for
 *   the term — a date, a number, a three-letter currency, a VAT number, a
 *   country code, an invoice type code.
 * - **Adds up** (`arithmetic`): with every proposal applied, whether the
 *   totals and lines agree — the lines add up to the net total, net plus
 *   VAT is the total, each line's net is quantity times price. A term in a
 *   sum that agrees gains; one in a sum that does not, loses.
 *
 * A proposal whose element is not in the sample, whose functions are not
 * in the closed list, or whose line term is drawn from outside the lines,
 * is dropped, never shown.
 */

/** What each term is usually called, lower case, letters and digits only. */
export const SYNONYMS: Record<string, string[]> = {
  "BT-1": ["rechnungsnummer", "rechnungsnr", "rechnungnr", "renr", "belegnr", "belegnummer", "invoicenumber", "invoiceno", "invoicenr", "invoiceid", "nummer", "number", "docno", "documentnumber"],
  "BT-2": ["rechnungsdatum", "datum", "belegdatum", "invoicedate", "issuedate", "date", "ausstellungsdatum"],
  "BT-3": ["rechnungsart", "belegart", "invoicetype", "typecode", "doctype", "art"],
  "BT-5": ["waehrung", "wahrung", "währung", "currency", "curr", "cur", "whg"],
  "BT-9": ["faellig", "fällig", "faelligkeit", "fälligkeit", "faelligam", "zahlbarbis", "duedate", "paymentdue", "due"],
  "BT-10": ["kundenreferenz", "ihrzeichen", "buyerreference", "reference", "referenz", "leitwegid"],
  "BT-11": ["projekt", "projektnummer", "project", "projectreference"],
  "BT-13": ["bestellung", "bestellnummer", "bestellnr", "auftrag", "auftragsnummer", "purchaseorder", "ponumber", "po", "orderno", "ordernumber", "order"],
  "BT-20": ["zahlungsbedingungen", "zahlungsziel", "paymentterms", "terms"],
  "BT-27": ["lieferant", "lieferantenname", "firma", "verkaeufer", "verkäufer", "seller", "sellername", "supplier", "suppliername", "vendor"],
  "BT-31": ["ustidnr", "ustid", "umsatzsteuerid", "vatid", "vatnumber", "vatno", "taxid", "vat"],
  "BT-34": ["email", "mail", "electronicaddress"],
  "BT-40": ["lieferantenland", "sellercountry", "land", "country", "countrycode"],
  "BT-44": ["kunde", "kundenname", "empfaenger", "empfänger", "rechnungsempfaenger", "buyer", "buyername", "customer", "customername"],
  "BT-48": ["kundeustid", "buyervatid", "customervat"],
  "BT-49": ["kundenemail", "buyeremail"],
  "BT-55": ["kundenland", "buyercountry", "land", "country", "countrycode"],
  "BT-106": ["summenetto", "nettosumme", "netto", "net", "nettobetrag", "sumoflines", "linetotal", "subtotal", "zwischensumme"],
  "BT-109": ["netto", "nettobetrag", "gesamtnetto", "net", "nettotal", "totalnet", "taxexclusive", "totalexclvat"],
  "BT-110": ["mwst", "ust", "umsatzsteuer", "mehrwertsteuer", "steuer", "vat", "tax", "vatamount", "taxamount", "totalvat"],
  "BT-112": ["brutto", "bruttobetrag", "gesamtbrutto", "gesamt", "gesamtbetrag", "gross", "total", "totalinclvat", "taxinclusive", "rechnungsbetrag"],
  "BT-115": ["zahlbetrag", "zuzahlen", "brutto", "gesamt", "amountdue", "payable", "payableamount", "total", "gross"],
  "BT-126": ["pos", "position", "posnr", "zeile", "lfdnr", "line", "lineno", "linenumber", "linenr", "nr"],
  "BT-127": ["positionsnotiz", "bemerkung", "notiz", "note", "linenote", "comment"],
  "BT-129": ["menge", "anzahl", "stueck", "stück", "qty", "quantity", "anz", "amount"],
  "BT-130": ["einheit", "me", "mengeneinheit", "unit", "uom", "unitofmeasure"],
  "BT-131": ["netto", "positionsnetto", "gesamtpreis", "betrag", "linenet", "lineamount", "netamount", "linetotal", "total", "summe"],
  "BT-132": ["bestellposition", "orderline", "polineref"],
  "BT-133": ["kostenstelle", "sachkonto", "konto", "account", "costcentre", "costcenter", "glcode"],
  "BT-146": ["einzelpreis", "preis", "stueckpreis", "stückpreis", "ep", "unitprice", "price", "netprice", "rate"],
  "BT-151": ["steuerkategorie", "mwstkategorie", "vatcategory", "taxcategory"],
  "BT-152": ["steuersatz", "mwstsatz", "ustsatz", "satz", "vatrate", "taxrate", "rate", "vatpercent"],
  "BT-153": ["artikel", "bezeichnung", "beschreibung", "artikelbezeichnung", "text", "leistung", "item", "itemname", "description", "product", "name"],
  "BT-154": ["langtext", "zusatztext", "itemdescription", "details", "longdescription"],
  "BT-155": ["artikelnummer", "artikelnr", "artnr", "sku", "itemno", "itemnumber", "productcode", "sellersitemid"],
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

/**
 * How well an element's name matches a term: 1 for a name it is usually
 * called, 0.8 where the name contains one (Rechnungsnr_Lieferant), 0.5
 * where the element's group does (Summen/Netto for a total), else 0.
 */
export function nameScore(path: string, target: string): number {
  const segments = path.split("/").filter((s) => s && !s.startsWith("@")).map(norm);
  const attr = path.includes("@") ? norm(path.split("@").pop() ?? "") : null;
  const name = attr ?? segments.at(-1) ?? "";
  const words = (SYNONYMS[target] ?? []).map(norm);
  if (words.includes(name)) return 1;
  if (words.some((w) => w.length >= 4 && (name.includes(w) || (name.length >= 4 && w.includes(name))))) return 0.8;
  const group = segments.slice(0, attr ? undefined : -1).join(" ");
  if (words.some((w) => w.length >= 4 && group.includes(w))) return 0.5;
  return 0;
}

const INVOICE_TYPES = new Set(["380", "381", "383", "384", "386", "389", "393", "751", "875", "876", "877"]);

/**
 * Whether a value, after the proposed functions, is right for a term:
 * 1 where it passes the term's own check (a real ISO date, a currency code,
 * a VAT number's shape...), 0.6 where it is only the right kind, 0 where
 * it is not (with the reason).
 */
export function valueScore(target: string, value: unknown): { score: number; reason?: string } {
  if (value === undefined || value === null || value === "") return { score: 0, reason: "no value" };
  const kind = MAPPING_TARGETS[target];
  const s = String(value).trim();
  if (kind === "date") return /^\d{4}-\d{2}-\d{2}$/.test(s) ? { score: 1 } : { score: 0, reason: `"${s}" is not a date` };
  if (kind === "number") {
    if (typeof value !== "number" && !Number.isFinite(Number(s))) return { score: 0, reason: `"${s}" is not a number` };
    return { score: target === "BT-152" ? (Number(s) >= 0 && Number(s) <= 100 ? 1 : 0.3) : 1 };
  }
  const checks: Record<string, RegExp | Set<string>> = {
    "BT-3": INVOICE_TYPES,
    "BT-5": /^[A-Z]{3}$/,
    "BT-31": /^[A-Z]{2}[A-Z0-9+*.]{2,13}$/,
    "BT-48": /^[A-Z]{2}[A-Z0-9+*.]{2,13}$/,
    "BT-40": /^[A-Z]{2}$/,
    "BT-55": /^[A-Z]{2}$/,
    "BT-130": /^[A-Z0-9]{2,3}$/,
    "BT-126": /^\S{1,20}$/,
    "BT-34": /^\S+@\S+$/,
    "BT-49": /^\S+@\S+$/,
  };
  const check = checks[target];
  if (!check) return { score: s.length > 0 ? 0.8 : 0 };
  const passes = check instanceof Set ? check.has(s) : check.test(s);
  return passes ? { score: 1 } : { score: 0.3, reason: `"${s}" is not the usual form for ${target}` };
}

const close = (a: number, b: number) => Math.abs(a - b) < 0.011 || Math.abs(a - b) <= Math.abs(b) * 0.0005;
const num = (v: unknown) => (typeof v === "number" ? v : v === undefined ? NaN : Number(v));

/**
 * Whether the invoice adds up, per term: true where every sum it is in
 * agrees, false where one does not, and absent where no sum could be
 * checked (a term is in none, or a sum's other terms are missing).
 */
export function arithmetic(facts: InvoiceFacts, lines: Array<InvoiceFacts & { lineNumber: number }>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const mark = (terms: string[], ok: boolean) => {
    for (const t of terms) out[t] = (out[t] ?? true) && ok;
  };
  const f = (t: string) => num(facts[t]);
  const lineNets = lines.map((l) => num(l["BT-131"]));
  if (lines.length > 0 && lineNets.every(Number.isFinite) && Number.isFinite(f("BT-106"))) {
    mark(["BT-106", "BT-131"], close(lineNets.reduce((a, b) => a + b, 0), f("BT-106")));
  }
  if (Number.isFinite(f("BT-106")) && Number.isFinite(f("BT-109"))) mark(["BT-106", "BT-109"], close(f("BT-106"), f("BT-109")));
  if (Number.isFinite(f("BT-109")) && Number.isFinite(f("BT-110")) && Number.isFinite(f("BT-112"))) {
    mark(["BT-109", "BT-110", "BT-112"], close(f("BT-109") + f("BT-110"), f("BT-112")));
  }
  if (Number.isFinite(f("BT-112")) && Number.isFinite(f("BT-115"))) mark(["BT-112", "BT-115"], close(f("BT-112"), f("BT-115")));
  const priced = lines.filter((l) => [l["BT-129"], l["BT-146"], l["BT-131"]].every((v) => Number.isFinite(num(v))));
  if (priced.length > 0) {
    mark(["BT-129", "BT-146", "BT-131"], priced.every((l) => close(num(l["BT-129"]) * num(l["BT-146"]), num(l["BT-131"]))));
  }
  return out;
}

export interface Proposal {
  target: string;
  /** From the root, as the editor draws it; a line's source is relative in `line`. */
  path: string;
  line: MappingLine;
  /** 0–100, computed by our code. */
  confidence: number;
  signals: { name: number; value: number; addsUp: boolean | null };
  /** The sample's value, and what it becomes. */
  sample: string | null;
  becomes?: string | number | null;
  /** Why the model proposed it, in its words; and a problem our checks found. */
  why?: string;
  problem?: string;
}

export interface ProposalContext {
  described: DescribedXml;
  /** The document the mapping reads (a CSV already as its small XML document). */
  xml: string;
  def: MappingDefinition;
  targets: Array<{ id: string; name: string; kind: "text" | "number" | "date"; line: boolean; required: boolean }>;
  lists?: Array<{ id: string; name: string; examples: Array<[string, string]> }>;
  ctx?: FnContext;
  /** Names of the supplier's CSV columns as written, where it is a CSV. */
  columns?: Array<{ name: string; element: string }> | null;
}

export function buildProposalPrompt(context: ProposalContext): string {
  const linesPath = context.def.linesPath;
  const column = (path: string) => context.columns?.find((c) => c.element === path.split("/").pop())?.name;
  const elements = context.described.elements
    .slice(0, 150)
    .map((e) => {
      const named = column(e.path);
      const where = linesPath && e.path.startsWith(`${linesPath}/`) ? "each line" : "whole invoice";
      return `- ${e.path}${named && named !== e.path.split("/").pop() ? ` (column "${named}")` : ""} [${where}]: ${JSON.stringify(e.sample)}`;
    })
    .join("\n");
  const open = context.targets.filter((t) => !context.def.lines.some((l) => l.target === t.id));
  const targets = open.map((t) => `- ${t.id}: ${t.name} (${t.kind}, ${t.line ? "each line" : "whole invoice"}${t.required ? ", required" : ""})`).join("\n");
  return `You map a supplier's own invoice file to EN 16931 Business Terms.
The file's elements, with where they are and a sample value:
${elements}

${linesPath ? `The invoice lines repeat at ${linesPath}.` : "The file has no repeating lines."}

Business Terms still to map:
${targets}

Functions you may use to turn a value into what the term needs (at most 5 per line):
${describeFunctions()}

The customer's look-up lists (for look_up, by id): ${(context.lists ?? []).map((l) => `${JSON.stringify(l.id)} ${l.name}`).join(", ") || "(none)"}

Rules:
- A whole-invoice term takes an element marked [whole invoice]. An amount for the whole invoice may take an element marked [each line]: its values are added up.
- A line term takes an element marked [each line].
- Dates must become ISO (read_date with the pattern as written). Amounts written with a decimal comma need decimal_comma.
- Propose only what the file carries. Leave out a term you cannot find.

Answer with JSON only, no prose:
{"lines": [{"target": "BT-..", "source": "<element path as listed>", "steps": [{"fn": "<function>", "args": {...}}], "why": "<a few words>"}]}`;
}

/**
 * The model's answer, checked and scored. Proposals our checks cannot
 * accept are dropped; the rest are scored with every one applied, so a
 * sum is checked with all of its terms.
 */
export function scoreProposals(raw: string, context: ProposalContext): { proposals: Proposal[]; dropped: number } {
  const json = extractJson(raw) as { lines?: unknown } | undefined;
  const items = Array.isArray(json?.lines) ? (json!.lines as Array<Record<string, unknown>>) : [];
  const linesPath = context.def.linesPath;
  const known = new Set(context.described.elements.map((e) => e.path));
  const taken = new Set(context.def.lines.map((l) => l.target));
  const lists = new Set((context.lists ?? []).map((l) => l.id));
  const accepted: Array<{ line: MappingLine; path: string; why?: string }> = [];
  let dropped = 0;
  for (const item of items) {
    const target = String(item.target ?? "");
    const path = String(item.source ?? "");
    const fx = (Array.isArray(item.steps) ? item.steps : []).map((s: { fn?: unknown; args?: unknown }) => ({
      fn: s?.fn,
      args: s?.args && typeof s.args === "object" ? s.args : {},
    })) as FunctionStep[];
    const inLines = !!linesPath && path.startsWith(`${linesPath}/`);
    const lineTerm = isLineTarget(target);
    const bad =
      !(target in MAPPING_TARGETS) ||
      taken.has(target) ||
      accepted.some((a) => a.line.target === target) ||
      !known.has(path) ||
      validateChain(fx) !== null ||
      fx.some((s) => s.fn === "look_up" && !lists.has(String(s.args?.list))) ||
      (lineTerm && !inLines) ||
      (!lineTerm && inLines && MAPPING_TARGETS[target] !== "number");
    if (bad) {
      dropped++;
      continue;
    }
    accepted.push({
      line: { target, source: lineTerm ? path.slice(linesPath!.length + 1) : path, fx, origin: "ai" },
      path,
      why: typeof item.why === "string" ? item.why.slice(0, 200) : undefined,
    });
  }

  // Everything applied at once, so each sum is checked with all its terms.
  const all: MappingDefinition = { ...context.def, lines: [...context.def.lines, ...accepted.map((a) => a.line)], rules: [] };
  let facts: InvoiceFacts = {};
  let lines: Array<InvoiceFacts & { lineNumber: number }> = [];
  try {
    const applied = applyMapping(context.xml, all, context.ctx);
    facts = applied.facts;
    lines = applied.lines;
  } catch {
    // Scored on names and values alone.
  }
  const addsUp = arithmetic(facts, lines);
  const sampleOf = (path: string) => context.described.elements.find((e) => e.path === path)?.sample ?? null;

  const proposals = accepted.map(({ line, path, why }): Proposal => {
    const sample = sampleOf(path);
    // What it becomes as the mapping reads it: a whole-invoice amount from
    // the lines is their sum, a line's term is the first line's.
    const read = isLineTarget(line.target) ? lines[0]?.[line.target] : facts[line.target];
    const r = read !== undefined && read !== null ? { ok: true as const, value: read as string | number } : applyChain(line.fx, sample, context.ctx);
    let becomes: string | number | null | undefined = r.ok ? r.value : undefined;
    if (r.ok && MAPPING_TARGETS[line.target] === "number" && typeof becomes === "string" && Number.isFinite(Number(becomes))) becomes = Number(becomes);
    const value = r.ok ? valueScore(line.target, becomes) : { score: 0, reason: r.reason };
    const name = nameScore(path, line.target);
    const sum = addsUp[line.target];
    const score = sum === undefined ? 0.55 * name + 0.45 * value.score : 0.35 * name + 0.3 * value.score + 0.35 * (sum ? 1 : 0);
    return {
      target: line.target,
      path,
      line,
      confidence: Math.round(Math.max(0, Math.min(1, score)) * 100),
      signals: { name, value: value.score, addsUp: sum === undefined ? null : sum },
      sample,
      ...(r.ok ? { becomes } : {}),
      ...(why ? { why } : {}),
      ...(value.reason ? { problem: value.reason } : sum === false ? { problem: "the invoice does not add up with it" } : {}),
    };
  });
  proposals.sort((a, b) => b.confidence - a.confidence);
  return { proposals, dropped };
}

export async function proposeMapping(model: CompilerModel, context: ProposalContext): Promise<{ proposals: Proposal[]; dropped: number; missingRequired: string[] }> {
  const raw = await model.compile(buildProposalPrompt(context));
  const scored = scoreProposals(raw, context);
  const covered = new Set([...context.def.lines.map((l) => l.target), ...(context.def.rules ?? []).map((r) => r.target), ...scored.proposals.map((p) => p.target)]);
  return { ...scored, missingRequired: context.targets.filter((t) => t.required && !covered.has(t.id)).map((t) => t.id) };
}
