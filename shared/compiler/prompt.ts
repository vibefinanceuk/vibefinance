import { buildVocabularyDoc } from "./vocabulary-doc.js";
import type { VocabularyName } from "../interpreter/vocabulary.js";

/**
 * The exact two JSON shapes the model is allowed to produce. Kept as a
 * literal string block (not generated from a TS type) so it can be read
 * top-to-bottom as what the model actually sees, and so a change here
 * is a deliberate, reviewable diff rather than a side effect of an
 * unrelated type change.
 */
const OUTPUT_CONTRACT = `Respond with a single JSON object and nothing else — no markdown code
fences, no explanation before or after it. Two possible shapes:

If the sentence CAN be expressed in the vocabulary:
{
  "status": "compiled",
  "conditions": <a condition or a combinator, see below>,
  "actions": [ { "type": "<action>", "params": { ... } }, ... ]
}

A condition:
  { "field": "<field>", "operator": "<operator>", "value": <value or omitted for is_present/is_empty> }

A combinator (nests conditions or other combinators):
  { "all": [ <condition or combinator>, ... ] }   // AND
  { "any": [ <condition or combinator>, ... ] }   // OR

If the sentence CANNOT be expressed using only the vocabulary above:
{
  "status": "refused",
  "reason": "<a short, specific explanation of what's missing — this is shown to the person who wrote the sentence>"
}`;

const WORKED_EXAMPLE = `Example sentence: "When the buyer VAT id is missing and the seller is outside the EU, assign a task to the AP team requiring the AP.Approve permission"
Example output:
{
  "status": "compiled",
  "conditions": {
    "all": [
      { "field": "BT-48", "operator": "is_empty" },
      { "field": "BT-40", "operator": "not_in", "value": ["DE", "FR", "NL", "IE", "ES", "IT"] }
    ]
  },
  "actions": [ { "type": "assign_task", "params": { "team": "AP team", "permission": "AP.Approve" } } ]
}

A second example, showing route_to (advancing a process to a named
stage — never a team or queue, that meaning was retired):
Example sentence: "If the invoice is from a US supplier, skip straight to payment-eligible"
Example output:
{
  "status": "compiled",
  "conditions": { "field": "BT-40", "operator": "is", "value": "US" },
  "actions": [ { "type": "route_to", "params": { "stage": "payment-eligible" } } ]
}`;

const EXPENSE_WORKED_EXAMPLE = `Example sentence: "If the expense category is Travel and no receipt is attached, assign a task to the finance team requiring the Expense.Review permission"
Example output:
{
  "status": "compiled",
  "conditions": {
    "all": [
      { "field": "category", "operator": "is", "value": "Travel" },
      { "field": "receipt_attached", "operator": "is", "value": false }
    ]
  },
  "actions": [ { "type": "assign_task", "params": { "team": "finance team", "permission": "Expense.Review" } } ]
}`;

const SYSTEM_DESCRIPTION: Record<VocabularyName, string> = {
  invoice: "an invoice-processing system",
  expense: "an expense-management system",
};

export function buildCompilerPrompt(sourceText: string, vocabulary: VocabularyName = "invoice"): string {
  const workedExample = vocabulary === "expense" ? EXPENSE_WORKED_EXAMPLE : WORKED_EXAMPLE;
  return `You are compiling a business rule for ${SYSTEM_DESCRIPTION[vocabulary]}. A customer has described a rule in their own words. Your job is to translate it into a strict, closed vocabulary — never to write general-purpose code, and never to approximate something the vocabulary can't express.

${buildVocabularyDoc(vocabulary)}

${OUTPUT_CONTRACT}

${workedExample}

The customer's sentence:
"${sourceText}"

Respond with the JSON object now.`;
}
