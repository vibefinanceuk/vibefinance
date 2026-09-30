import { extractJson } from "../compiler/parse.js";
import type { CompilerModel } from "../compiler/types.js";
import { applyChain, describeFunctions, validateChain, type FnContext, type FunctionStep } from "./mapping-functions.js";

/**
 * A mapping line's function, said in plain words and compiled — decision
 * 0561, as the rule compiler does for rules (0002, 0007).
 *
 * The same three disciplines:
 *
 * - **A closed vocabulary.** The model may only answer with functions from
 *   `mapping-functions.ts`, and what it answers is validated against that
 *   list before anything uses it. An answer naming anything else is a
 *   refusal, not an approximation.
 * - **Refusal is an answer.** "Write the country in the supplier's own
 *   language" has no function, and the person is told so in words.
 * - **Worked examples, checked.** The compiled chain is run over the real
 *   values the element holds in the kept sample, and the person sees each
 *   one, before and after, before accepting it. The examples are computed
 *   by our code, never written by the model, so they cannot flatter it.
 */

export interface FunctionContext {
  /** What the value becomes: its Business Term and name. */
  target: string;
  targetName: string;
  kind: "text" | "number" | "date";
  /** Values the element holds in the kept sample, as written. */
  samples: string[];
  /**
   * **The customer's look-up lists — decision 0568**: each list's id and
   * name, with a few of its entries, so "look it up in Units" can be
   * compiled; and the lists themselves, for the worked examples.
   */
  lists?: Array<{ id: string; name: string; examples: Array<[from: string, to: string]> }>;
  ctx?: FnContext;
}

export interface WorkedExample {
  input: string | null;
  output?: string | number | null;
  reason?: string;
}

export type FunctionOutcome =
  | { kind: "compiled"; steps: FunctionStep[]; examples: WorkedExample[] }
  | { kind: "refused"; reason: string };

const WHAT_EACH_KIND_NEEDS = {
  text: "text",
  number: "a number (a JavaScript number, with a decimal point)",
  date: "an ISO date, yyyy-MM-dd",
};

export function buildFunctionPrompt(say: string, context: FunctionContext): string {
  return `You turn a person's instruction about one value on an invoice into a chain of functions.
You may ONLY use these functions, with exactly these arguments:

${describeFunctions()}

The value will become ${context.target} (${context.targetName}), which must end up as ${WHAT_EACH_KIND_NEEDS[context.kind]}.
Values this element holds in the document, as written: ${context.samples.slice(0, 5).map((s) => JSON.stringify(s)).join(", ") || "(none)"}.

The customer's look-up lists, for look_up (use the id as the list argument):
${
  (context.lists ?? []).length === 0
    ? "(none: look_up cannot be used, so refuse an instruction that needs a list)"
    : (context.lists ?? [])
        .map((l) => `- ${JSON.stringify(l.id)}: ${l.name}${l.examples.length > 0 ? `, for example ${l.examples.slice(0, 3).map(([f, t]) => `${JSON.stringify(f)} becomes ${JSON.stringify(t)}`).join(", ")}` : ""}`)
        .join("\n")
}

The person said: ${JSON.stringify(say)}

Answer with JSON only, no prose:
{"steps": [{"fn": "<function>", "args": {...}}]}
At most 5 steps, applied in order. A function with no arguments has "args": {}.
If the instruction cannot be done with these functions alone, answer instead:
{"refused": "<one plain sentence saying what cannot be done, and what can>"}`;
}

export function parseFunctionOutput(raw: string): { kind: "compiled"; steps: FunctionStep[] } | { kind: "refused"; reason: string } {
  const json = extractJson(raw) as { steps?: unknown; refused?: unknown } | undefined;
  if (!json || typeof json !== "object") return { kind: "refused", reason: "The instruction could not be understood. Try saying it another way." };
  if (typeof json.refused === "string" && json.refused.trim() !== "") return { kind: "refused", reason: json.refused.trim() };
  const steps = (Array.isArray(json.steps) ? json.steps : []).map((s: { fn?: unknown; args?: unknown }) => ({
    fn: s?.fn,
    args: s?.args && typeof s.args === "object" ? s.args : {},
  })) as FunctionStep[];
  const invalid = validateChain(steps);
  if (invalid) return { kind: "refused", reason: `That needs something the functions cannot do (${invalid}).` };
  if (steps.length === 0) return { kind: "refused", reason: "That asks for no change to the value, so no function is needed." };
  return { kind: "compiled", steps };
}

/** Runs a chain over sample values: what a person checks before accepting it. */
export function workedExamples(steps: readonly FunctionStep[], samples: readonly (string | null)[], ctx?: FnContext): WorkedExample[] {
  const unique = [...new Set(samples)].slice(0, 5);
  return (unique.length > 0 ? unique : [null]).map((input) => {
    const r = applyChain(steps, input, ctx);
    return r.ok ? { input, output: r.value } : { input, reason: r.reason };
  });
}

export async function compileFunction(model: CompilerModel, say: string, context: FunctionContext): Promise<FunctionOutcome> {
  if (say.trim() === "") return { kind: "refused", reason: "Say what should happen to the value." };
  const raw = await model.compile(buildFunctionPrompt(say, context));
  const parsed = parseFunctionOutput(raw);
  if (parsed.kind === "refused") return parsed;
  // A list the model named that is not one of the customer's is refused, never guessed.
  const known = new Set((context.lists ?? []).map((l) => l.id));
  const unknown = parsed.steps.find((s) => s.fn === "look_up" && !known.has(String(s.args?.list)));
  if (unknown) return { kind: "refused", reason: `There is no look-up list "${unknown.args?.list}". Make it on the Routes screen first.` };
  return { kind: "compiled", steps: parsed.steps, examples: workedExamples(parsed.steps, context.samples, context.ctx) };
}
