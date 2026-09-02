import { buildCompilerPrompt } from "./prompt.js";
import { parseModelOutput } from "./parse.js";
import type { CompileOutcome, CompilerModel } from "./types.js";
import type { VocabularyInput } from "../interpreter/vocabulary.js";

/**
 * Compile one customer sentence into a rule, or a refusal. Pure
 * orchestration — no I/O beyond the injected model, no persistence.
 * Persisting a "compiled" outcome (as an unapproved rule_version — "A
 * person activated this. Never auto-promote a generated rule.",
 * Blueprint) is the caller's job, typically a Worker route handler with
 * a D1 binding.
 *
 * vocabulary defaults to "invoice" — every caller written before
 * decision 0022's multi-vocabulary support existed continues
 * compiling against exactly the same vocabulary it always did.
 */
export async function compileRule(
  model: CompilerModel,
  sourceText: string,
  vocabulary: VocabularyInput = "invoice"
): Promise<CompileOutcome> {
  const prompt = buildCompilerPrompt(sourceText, vocabulary);
  const raw = await model.compile(prompt);
  return parseModelOutput(raw, vocabulary);
}
