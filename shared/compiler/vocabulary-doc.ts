import {
  ACTIONS,
  ACTION_DESCRIPTIONS,
  DERIVED_FIELD_PREFIXES,
  OPERATORS,
  VOCABULARIES,
} from "../interpreter/vocabulary.js";
import type { VocabularyName } from "../interpreter/vocabulary.js";
import { MAX_COMBINATOR_DEPTH } from "../interpreter/evaluate.js";

/**
 * Renders the closed vocabulary as text for the compiler's prompt.
 * Built from the same constants shared/interpreter/vocabulary.ts
 * validates against — never a hand-maintained second list — so the
 * prompt can never drift out of sync with what the interpreter will
 * actually accept. If it did, the model would confidently emit
 * something valid-looking that gets refused downstream, which is a
 * worse failure than either side just being wrong consistently.
 *
 * vocabulary defaults to "invoice" — every caller written before
 * decision 0022's multi-vocabulary support existed renders exactly
 * the same prompt text it always did, unchanged.
 */
export function buildVocabularyDoc(vocabulary: VocabularyName = "invoice"): string {
  const v = VOCABULARIES[vocabulary];
  const fieldLines = v.fields.map((f) => `  ${f} — ${v.fieldDescriptions[f]}`).join("\n");
  const derivedLines = v.derivedFields.map((f) => `  ${f} — ${v.derivedFieldDescriptions[f]}`).join("\n");
  // term.absent(BT-n) is inherently an invoice/EN-16931 concept — a
  // Business Term either appears on an invoice or it doesn't. Nothing
  // analogous exists for expense fields, so this section is only
  // rendered for the invoice vocabulary rather than confusing the
  // model with a concept that has no meaning for what it's actually
  // compiling.
  const parameterisedLines =
    vocabulary === "invoice"
      ? DERIVED_FIELD_PREFIXES.map(
          (p) => `  ${p}BT-n) — true if that Business Term is absent from the invoice`
        ).join("\n")
      : "";

  const actionLines = ACTIONS.map(
    (a) => `  ${a} — ${ACTION_DESCRIPTIONS[a]}`
  ).join("\n");

  const fieldsHeading = vocabulary === "invoice" ? "INVOICE FIELDS (from the standard):" : "EXPENSE FIELDS:";
  const derivedHeading =
    vocabulary === "invoice"
      ? "PLATFORM-DERIVED FIELDS (never invoice data, always platform-computed):"
      : "PLATFORM-DERIVED FIELDS (never submitted by the employee, always platform-computed):";

  return `${fieldsHeading}
${fieldLines}

${derivedHeading}
${derivedLines}
${parameterisedLines}

OPERATORS:
  ${OPERATORS.join(", ")}

ACTIONS (with the exact params shape each one expects — use these
keys precisely; a plausible-sounding alternative like "assignee"
instead of "team"/"user" will not be understood by anything that
consumes this action downstream):
${actionLines}

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
