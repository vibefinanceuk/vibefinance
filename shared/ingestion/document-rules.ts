import { extractJson } from "../compiler/parse.js";
import type { CompilerModel } from "../compiler/types.js";
import type { InvoiceFacts } from "../interpreter/types.js";
import { applyRules, MAPPING_TARGETS, validateRules, type DocumentRule, type MappingLine } from "./mapping-engine.js";
import { describeFunctions, type FnContext, type FunctionStep } from "./mapping-functions.js";

/**
 * **A rule for the whole invoice, said in plain words — decision 0569.**
 *
 * Compiled the way a line's function is (0561) and a stage's rules are
 * (0002, 0007), with the same three disciplines:
 *
 * - **A closed shape.** A rule fills one whole-invoice term, when it is
 *   missing or always, from another whole-invoice term or from nothing,
 *   through functions from the closed list. Anything else is refused.
 * - **Refusal is an answer**, in one plain sentence.
 * - **A worked example, computed by our code**: the rule is applied to
 *   the facts the draft reads from its own sample, and the person sees the
 *   term before and after. The model never writes it.
 */

export interface DocumentRuleContext {
  /** Whole-invoice terms, with their names, a rule may fill or work from. */
  terms: Array<{ id: string; name: string; kind: "text" | "number" | "date" }>;
  /** What the draft reads from its sample, before the rule. */
  facts: InvoiceFacts;
  /** The mapping's lines, which a rule must not override. */
  lines: MappingLine[];
  /** The customer's look-up lists (0568), for the prompt and the example. */
  lists?: Array<{ id: string; name: string; examples: Array<[string, string]> }>;
  ctx?: FnContext;
}

export interface DocumentRuleExample {
  target: string;
  before: string | number | null;
  after?: string | number | null;
  reason?: string;
}

export type DocumentRuleOutcome = { kind: "compiled"; rule: DocumentRule; example: DocumentRuleExample } | { kind: "refused"; reason: string };

export function buildDocumentRulePrompt(say: string, context: DocumentRuleContext): string {
  const terms = context.terms.map((t) => {
    const v = context.facts[t.id];
    return `- ${t.id} (${t.name}, ${t.kind})${v !== undefined && v !== "" ? `: ${JSON.stringify(v)}` : ": not on this invoice"}`;
  });
  return `You turn a person's rule about a whole invoice into one structured rule.
A rule fills ONE whole-invoice term (target): when it is "missing", or "always".
It works from another whole-invoice term (from), or from nothing (from: null) with a fixed value,
through a chain of these functions only (at most 5 steps):

${describeFunctions()}

Whole-invoice terms, with this invoice's values:
${terms.join("\n")}

Dates are ISO (yyyy-MM-dd). A number is a JavaScript number.

The customer's look-up lists, for look_up (use the id as the list argument):
${(context.lists ?? []).length === 0 ? "(none)" : (context.lists ?? []).map((l) => `- ${JSON.stringify(l.id)}: ${l.name}`).join("\n")}

The person said: ${JSON.stringify(say)}

Answer with JSON only, no prose:
{"rule": {"target": "BT-..", "when": "missing" | "always", "from": "BT-.." | null, "steps": [{"fn": "<function>", "args": {...}}]}}
Prefer "missing" unless the person clearly means always.
If it cannot be done as one such rule, answer instead:
{"refused": "<one plain sentence saying what cannot be done, and what can>"}`;
}

export function parseDocumentRuleOutput(raw: string, lines: MappingLine[]): { kind: "compiled"; rule: DocumentRule } | { kind: "refused"; reason: string } {
  const json = extractJson(raw) as { rule?: Record<string, unknown>; refused?: unknown } | undefined;
  if (!json || typeof json !== "object") return { kind: "refused", reason: "The rule could not be understood. Try saying it another way." };
  if (typeof json.refused === "string" && json.refused.trim() !== "") return { kind: "refused", reason: json.refused.trim() };
  const r = json.rule ?? {};
  const rule: DocumentRule = {
    target: String(r.target ?? ""),
    when: r.when === "always" ? "always" : "missing",
    from: typeof r.from === "string" && r.from !== "" ? r.from : null,
    fx: (Array.isArray(r.steps) ? r.steps : []).map((s: { fn?: unknown; args?: unknown }) => ({
      fn: s?.fn,
      args: s?.args && typeof s.args === "object" ? s.args : {},
    })) as FunctionStep[],
  };
  if (!(rule.target in MAPPING_TARGETS)) return { kind: "refused", reason: `"${rule.target}" is not a term a rule can fill.` };
  const invalid = validateRules([rule], lines);
  if (invalid) return { kind: "refused", reason: `That needs something a rule cannot do (${invalid.replace(/^rule 1: /, "")}).` };
  return { kind: "compiled", rule };
}

/** The rule applied to the sample's facts: the term before and after. */
export function documentRuleExample(rule: DocumentRule, facts: InvoiceFacts, ctx?: FnContext): DocumentRuleExample {
  const before = facts[rule.target];
  const copy: InvoiceFacts = { ...facts };
  const problems = applyRules(copy, [rule], ctx);
  const shown = (v: unknown) => (v === undefined || v === "" ? null : (v as string | number));
  return problems.length > 0
    ? { target: rule.target, before: shown(before), reason: problems[0].reason }
    : { target: rule.target, before: shown(before), after: shown(copy[rule.target]) };
}

export async function compileDocumentRule(model: CompilerModel, say: string, context: DocumentRuleContext): Promise<DocumentRuleOutcome> {
  if (say.trim() === "") return { kind: "refused", reason: "Say what the rule should do." };
  const parsed = parseDocumentRuleOutput(await model.compile(buildDocumentRulePrompt(say, context)), context.lines);
  if (parsed.kind === "refused") return parsed;
  const known = new Set((context.lists ?? []).map((l) => l.id));
  const unknown = parsed.rule.fx.find((s) => s.fn === "look_up" && !known.has(String(s.args?.list)));
  if (unknown) return { kind: "refused", reason: `There is no look-up list "${unknown.args?.list}". Make it on the Routes screen first.` };
  return { kind: "compiled", rule: { ...parsed.rule, say: say.trim() }, example: documentRuleExample(parsed.rule, context.facts, context.ctx) };
}
