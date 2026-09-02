import { evaluateConditions } from "../interpreter/evaluate.js";
import type { InvoiceFacts, RuleAction, RuleNode } from "../interpreter/types.js";
import type { VocabularyInput } from "../interpreter/vocabulary.js";
import { buildVocabularyDoc } from "./vocabulary-doc.js";
import { extractJson, truncate } from "./parse.js";
import type { CompilerModel } from "./types.js";

/**
 * A worked example for a compiled rule — Blueprint, "Subsystem one":
 * "have it also produce invoices the rule should and should not fire
 * on, and make the author confirm them before activation." Both
 * directions matter equally; a rule with only "should fire" examples
 * gives the author no way to confirm it stays silent when it should.
 */
export interface RuleExample {
  invoice: InvoiceFacts;
  expectMatch: boolean;
}

export type ExamplesOutcome =
  | { kind: "generated"; examples: RuleExample[]; rawModelOutput: string }
  | { kind: "refused"; reason: string; rawModelOutput?: string };

const MIN_MATCHING_EXAMPLES = 1;
const MIN_NON_MATCHING_EXAMPLES = 1;

/** Walks a rule's conditions to find every field it actually
 * references, so the prompt can tell the model exactly which fields
 * an example invoice must set concrete values for — an example that
 * leaves those fields unset would be evaluating against undefined,
 * not really exercising the rule at all. */
function referencedFields(node: RuleNode): string[] {
  if ("all" in node) return node.all.flatMap(referencedFields);
  if ("any" in node) return node.any.flatMap(referencedFields);
  return [node.field];
}

/**
 * vocabulary defaults to "invoice" — matches compileRule's own
 * default (decision 0022), so every caller written before
 * multi-vocabulary support existed keeps generating invoice-shaped
 * examples exactly as before.
 *
 * The prompt's own wording was previously hardcoded to "invoice-
 * processing rule" and "invoices" regardless of which vocabulary the
 * rule actually used — found live: an Expense-vocabulary rule's own
 * worked examples came back containing real invoice fields (BT-1,
 * direction) that don't belong to the Expense vocabulary at all,
 * mixed in alongside the genuinely Expense-shaped ones. Doesn't
 * change correctness (the interpreter only reads what a rule's
 * conditions reference), but it's exactly the kind of vocabulary-
 * discipline gap this project doesn't otherwise tolerate. Fixed at
 * the same two places compileRule already gets this right: the
 * vocabulary doc itself, and the prompt's own framing language.
 */
function buildExamplesPrompt(conditions: RuleNode, actions: RuleAction[], vocabulary: VocabularyInput = "invoice"): string {
  const fields = [...new Set(referencedFields(conditions))];
  return `You previously compiled a business rule into the following closed-vocabulary structure. Your job now is to produce worked examples of records, so the person who wrote this rule can confirm it does what they meant — before it's ever allowed to run for real.

${buildVocabularyDoc(vocabulary)}

THE COMPILED RULE:
Conditions: ${JSON.stringify(conditions)}
Actions: ${JSON.stringify(actions)}

Fields this rule's conditions actually reference (every example must set a concrete value for each of these — leaving one unset does not meaningfully exercise the rule): ${fields.join(", ")}

TASK:
Produce at least ${MIN_MATCHING_EXAMPLES} example record(s) where these conditions evaluate to true (the rule fires), and at least ${MIN_NON_MATCHING_EXAMPLES} example record(s) where they evaluate to false (the rule does not fire). Both directions matter — an author needs to confirm the rule stays silent when it should, not just that it fires when it should.

Each example's "invoice" object may include realistic values for other fields from the vocabulary above too, for context — but never a field from a different vocabulary, and every referenced field above must be set.

Respond with a single JSON object and nothing else — no markdown fences, no explanation:
{
  "examples": [
    { "invoice": { "<field>": <value>, ... }, "expectMatch": true },
    { "invoice": { "<field>": <value>, ... }, "expectMatch": false }
  ]
}

Respond with the JSON object now.`;
}

interface RawExample {
  invoice: unknown;
  expectMatch: unknown;
}

function isRawExample(value: unknown): value is RawExample {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.invoice === "object" && v.invoice !== null && typeof v.expectMatch === "boolean";
}

function parseExamplesResponse(
  raw: string,
  conditions: RuleNode
): ExamplesOutcome {
  const parsed = extractJson(raw);
  if (parsed === undefined || typeof parsed !== "object" || parsed === null) {
    return {
      kind: "refused",
      reason: "The model's response could not be parsed as a JSON object. Raw output: " + truncate(raw),
      rawModelOutput: raw,
    };
  }
  const examplesField = (parsed as Record<string, unknown>).examples;
  if (!Array.isArray(examplesField)) {
    return {
      kind: "refused",
      reason: "The model's response had no 'examples' array. Raw output: " + truncate(raw),
      rawModelOutput: raw,
    };
  }
  if (!examplesField.every(isRawExample)) {
    return {
      kind: "refused",
      reason:
        "One or more examples did not match the expected shape (invoice: object, expectMatch: boolean). Raw output: " +
        truncate(raw),
      rawModelOutput: raw,
    };
  }

  const examples = examplesField as RuleExample[];

  // The self-verification step: never trust the model's claimed
  // expectMatch — check it against the exact same evaluation logic
  // that runs in production. A single mismatch refuses the whole
  // batch rather than silently keeping "the good ones", matching the
  // same refuse-rather-than-approximate discipline the main compiler
  // already follows.
  for (const example of examples) {
    const actual = evaluateConditions(conditions, example.invoice);
    if (actual !== example.expectMatch) {
      return {
        kind: "refused",
        reason: `The model claimed expectMatch=${example.expectMatch} for an example, but the real interpreter evaluates it as ${actual}. Refusing the whole batch rather than trusting an inconsistent one. Example: ${JSON.stringify(example.invoice)}`,
        rawModelOutput: raw,
      };
    }
  }

  const matchingCount = examples.filter((e) => e.expectMatch).length;
  const nonMatchingCount = examples.length - matchingCount;
  if (matchingCount < MIN_MATCHING_EXAMPLES || nonMatchingCount < MIN_NON_MATCHING_EXAMPLES) {
    return {
      kind: "refused",
      reason: `Need at least ${MIN_MATCHING_EXAMPLES} matching and ${MIN_NON_MATCHING_EXAMPLES} non-matching example(s); got ${matchingCount} matching and ${nonMatchingCount} non-matching.`,
      rawModelOutput: raw,
    };
  }

  return { kind: "generated", examples, rawModelOutput: raw };
}

/**
 * Generate worked examples for an already-compiled rule. A separate
 * model call from the rule compilation itself (shared/compiler/
 * compile.ts's compileRule) — keeps the compiler's own refusal
 * boundary and prompt entirely unchanged, and means this can fail or
 * be retried independently of whether the rule itself compiled fine.
 */
export async function generateExamples(
  model: CompilerModel,
  conditions: RuleNode,
  actions: RuleAction[],
  vocabulary: VocabularyInput = "invoice"
): Promise<ExamplesOutcome> {
  const prompt = buildExamplesPrompt(conditions, actions, vocabulary);
  const raw = await model.compile(prompt);
  return parseExamplesResponse(raw, conditions);
}
