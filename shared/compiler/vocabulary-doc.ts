import {
  ACTIONS,
  DERIVED_FIELDS,
  DERIVED_FIELD_DESCRIPTIONS,
  DERIVED_FIELD_PREFIXES,
  FIELD_DESCRIPTIONS,
  INVOICE_FIELDS,
  OPERATORS,
} from "../interpreter/vocabulary.js";
import { MAX_COMBINATOR_DEPTH } from "../interpreter/evaluate.js";

/**
 * Renders the closed vocabulary as text for the compiler's prompt.
 * Built from the same constants shared/interpreter/vocabulary.ts
 * validates against — never a hand-maintained second list — so the
 * prompt can never drift out of sync with what the interpreter will
 * actually accept. If it did, the model would confidently emit
 * something valid-looking that gets refused downstream, which is a
 * worse failure than either side just being wrong consistently.
 */
export function buildVocabularyDoc(): string {
  const fieldLines = INVOICE_FIELDS.map(
    (f) => `  ${f} — ${FIELD_DESCRIPTIONS[f]}`
  ).join("\n");
  const derivedLines = DERIVED_FIELDS.map(
    (f) => `  ${f} — ${DERIVED_FIELD_DESCRIPTIONS[f]}`
  ).join("\n");
  const parameterisedLines = DERIVED_FIELD_PREFIXES.map(
    (p) => `  ${p}BT-n) — true if that Business Term is absent from the invoice`
  ).join("\n");

  return `INVOICE FIELDS (from the standard):
${fieldLines}

PLATFORM-DERIVED FIELDS (never invoice data, always platform-computed):
${derivedLines}
${parameterisedLines}

OPERATORS:
  ${OPERATORS.join(", ")}

ACTIONS:
  ${ACTIONS.join(", ")}

RULES ABOUT THE VOCABULARY:
- You may ONLY use fields, operators and actions from the lists above.
  Never invent a field, operator or action name, even if it seems like
  an obvious extension.
- Conditions may be combined with "all" (AND) or "any" (OR) combinators,
  nested to a maximum depth of ${MAX_COMBINATOR_DEPTH}.
- If the sentence cannot be expressed using only this vocabulary, you
  must refuse rather than approximate it with the closest available
  fields/operators/actions.`;
}
