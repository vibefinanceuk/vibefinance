import { buildVocabularyDoc } from "./vocabulary-doc.js";

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

const WORKED_EXAMPLE = `Example sentence: "When the buyer VAT id is missing and the seller is outside the EU, route it to tax review"
Example output:
{
  "status": "compiled",
  "conditions": {
    "all": [
      { "field": "BT-48", "operator": "is_empty" },
      { "field": "BT-40", "operator": "not_in", "value": ["DE", "FR", "NL", "IE", "ES", "IT"] }
    ]
  },
  "actions": [ { "type": "route_to", "params": { "queue": "tax_review" } } ]
}`;

export function buildCompilerPrompt(sourceText: string): string {
  return `You are compiling a business rule for an invoice-processing system. A customer has described a rule in their own words. Your job is to translate it into a strict, closed vocabulary — never to write general-purpose code, and never to approximate something the vocabulary can't express.

${buildVocabularyDoc()}

${OUTPUT_CONTRACT}

${WORKED_EXAMPLE}

The customer's sentence:
"${sourceText}"

Respond with the JSON object now.`;
}
