import {
  asResolved,
  ACTIONS,
  ACTION_DESCRIPTIONS,
  DERIVED_FIELD_PREFIXES,
  OPERATORS,
} from "../interpreter/vocabulary.js";
import type { VocabularyInput } from "../interpreter/vocabulary.js";
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
export function buildVocabularyDoc(vocabulary: VocabularyInput = "invoice"): string {
  const v = asResolved(vocabulary);
  // Standard fields only here — a customer's own declared fields get
  // their own clearly-labelled section below (decision 0041), so the
  // model can tell what came from the standard and what this
  // particular customer defined. Rendering them in one undifferentiated
  // list would blur exactly the distinction the closed vocabulary
  // exists to keep sharp.
  const customKeys = new Set(v.customFields.map((f) => f.key));
  const standardFields = v.fields.filter((f) => !customKeys.has(f));
  // Types are rendered alongside each field (decision 0041): the
  // model choosing an operator needs to know that BT-1 is a textual
  // reference and BT-112 is an amount, or it will produce rules that
  // validateRule then refuses.
  const withType = (f: string) => {
    const t = v.fieldTypes[f];
    return t ? `  ${f} (${t}) — ${v.fieldDescriptions[f]}` : `  ${f} — ${v.fieldDescriptions[f]}`;
  };
  const fieldLines = standardFields.map(withType).join("\n");
  const derivedLines = v.derivedFields
    .map((f) => {
      const t = v.fieldTypes[f];
      return t
        ? `  ${f} (${t}) — ${v.derivedFieldDescriptions[f]}`
        : `  ${f} — ${v.derivedFieldDescriptions[f]}`;
    })
    .join("\n");
  // term.absent(BT-n) is inherently an invoice/EN-16931 concept — a
  // Business Term either appears on an invoice or it doesn't. Nothing
  // analogous exists for expense fields, so this section is only
  // rendered for the invoice vocabulary rather than confusing the
  // model with a concept that has no meaning for what it's actually
  // compiling.
  // Each prefix gets its own description. Mapping them all to one
  // line was correct while term.absent was the only parameterised
  // field, and became wrong the moment a second one existed —
  // extraction.alternative is not a presence test and describing it
  // as one would guarantee the model misuses it.
  const PARAMETERISED_DESCRIPTIONS: Record<string, string> = {
    "term.absent(": "term.absent(BT-n) — true if that Business Term is absent from the invoice",
    "extraction.alternative(":
      "extraction.alternative(BT-n) — for a multi-page document where the pages disagreed about a field, what a LATER page said for it. The merged value came from an earlier page; this is the other reading. Present only for fields listed in extraction.conflicts, and absent otherwise — so a rule copying from it when the pages agreed changes nothing.",
  };
  const parameterisedLines =
    v.name === "invoice"
      ? DERIVED_FIELD_PREFIXES.map((p) => `  ${PARAMETERISED_DESCRIPTIONS[p] ?? `${p}...)`}`).join("\n")
      : "";

  const actionLines = ACTIONS.map(
    (a) => `  ${a} — ${ACTION_DESCRIPTIONS[a]}`
  ).join("\n");

  const fieldsHeading = v.name === "invoice" ? "INVOICE FIELDS (from the standard):" : "EXPENSE FIELDS:";
  const derivedHeading =
    v.name === "invoice"
      ? "PLATFORM-DERIVED FIELDS (never invoice data, always platform-computed):"
      : "PLATFORM-DERIVED FIELDS (never submitted by the employee, always platform-computed):";

  // A customer's own declared fields, kept in a clearly separate,
  // clearly labelled section (decision 0041). The model is told
  // plainly that these are this customer's own definitions and that
  // the descriptions are theirs, not the standard's — so it does not
  // treat a customer's field as if it carried EN 16931's authority,
  // and does not offer them to a customer who never declared any.
  const customSection =
    v.customFields.length === 0
      ? ""
      : `

FIELDS THIS CUSTOMER HAS DEFINED THEMSELVES (not part of any standard —
these descriptions are the customer's own, and apply only to them):
${v.customFields.map((f) => `  ${f.key} (${f.type}) — ${f.description}`).join("\n")}`;

  return `${fieldsHeading}
${fieldLines}

${derivedHeading}
${derivedLines}
${parameterisedLines}${customSection}

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
