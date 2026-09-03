import { asResolved, type VocabularyInput } from "@vibefinance/shared";
import type { FieldType, InvoiceFacts, RuleAction } from "@vibefinance/shared";

/**
 * set_field — decision 0049.
 *
 * The action has been in the closed vocabulary since the beginning,
 * described in ACTION_DESCRIPTIONS, and implemented nowhere. The
 * third such capability found this week, after 'warned' (0040) and
 * validation.passed (0044).
 *
 * It exists because a real conflict needed resolving: a two-page
 * invoice where page 1 fabricated a total and page 2 read the printed
 * one. The merge deliberately does not resolve that (decision 0048) —
 * a customer decides, by rule, and this is how the decision takes
 * effect.
 *
 * Two sources, and exactly one per action: a literal, or a copy of
 * another field's current value. Deliberately NOT a composition of
 * several — joining values is a short step from string manipulation,
 * and string manipulation is a short step from the rule language
 * ceasing to be closed, which is the property Document 2 calls "the
 * feature". A customer needing a reference built from two fields is a
 * real requirement and a separate decision.
 */

export interface FieldOverride {
  ruleId: string;
  field: string;
  /** Absent when the field had no prior value. A rule SETTING a field
   *  is a different act from a rule OVERWRITING one, and the audit
   *  record keeps them distinguishable — the second is the more
   *  consequential. */
  previousValue?: string | number | boolean;
  newValue: string | number | boolean;
}

export interface SetFieldOutcome {
  facts: InvoiceFacts;
  overrides: FieldOverride[];
}

/**
 * Applies every set_field action a rule fired, in order, returning
 * the new fact set and a record of what changed.
 *
 * Order within a single rule is the order the actions were written.
 * Two actions setting the same field means the later one wins and
 * both are recorded — the record shows the sequence rather than
 * hiding the first behind the second.
 *
 * A no-op is not recorded. Setting a field to the value it already
 * holds changed nothing, and filling the audit trail with
 * non-changes would make the real ones harder to find.
 */
/**
 * Whether a value may be written into a field of this declared type.
 *
 * Found by reading generated worked examples, not by testing: the
 * model produced an alternative total as the STRING "1185.00" for a
 * field declared `number`. The real data path carries types through
 * intact, so it would not have happened live — but nothing stopped
 * it, and a string in a numeric field is exactly the
 * silent-never-fires bug decision 0041's type system exists to
 * prevent. A downstream `greater_than` would simply stop matching,
 * with no error anywhere.
 *
 * Numeric strings are coerced rather than refused: "1185.00" is
 * unambiguously the number a document printed, and refusing it would
 * reject a correct value on a formatting technicality. Prose is not
 * coerced — the same boundary extraction already draws.
 *
 * Defaults to the invoice vocabulary, which covers every STANDARD
 * field. A customer-defined field has no declared type here unless
 * the caller passes its resolved vocabulary, and an unknown type
 * permits any value — an honest "cannot say" rather than a guess.
 * The workflow engine does not currently resolve a vocabulary at
 * all, so custom fields go unchecked today; that is a real and
 * stated limit, not an oversight.
 */
function coerceForField(
  value: string | number | boolean,
  type: FieldType | undefined
): string | number | boolean | undefined {
  if (type === undefined) return value; // No declared type: nothing to check against.
  if (type === "number") {
    if (typeof value === "number") return value;
    if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
      return Number(value.trim());
    }
    return undefined;
  }
  if (type === "boolean") return typeof value === "boolean" ? value : undefined;
  if (type === "date") {
    if (typeof value !== "string") return undefined;
    return /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : undefined;
  }
  return typeof value === "string" ? value : String(value);
}

export function applySetFieldActions(
  facts: InvoiceFacts,
  // Each action paired with the rule that fired it. Previously this
  // took a flat action list plus a single ruleId guessed from the
  // trace, which attributed EVERY override to whichever rule matched
  // first — wrong whenever more than one rule matched, and wrong in
  // exactly the table whose purpose is answering "which rule changed
  // this?". Found live: a correct resolution was credited to the
  // task-raising rule that happened to sort ahead of it.
  attributed: readonly { ruleId: string; action: RuleAction }[],
  vocabulary: VocabularyInput = "invoice"
): SetFieldOutcome {
  const next: InvoiceFacts = { ...facts };
  const overrides: FieldOverride[] = [];
  const fieldTypes = asResolved(vocabulary).fieldTypes;

  for (const { ruleId, action } of attributed) {
    if (action.type !== "set_field") continue;
    const params = (action.params ?? {}) as Record<string, unknown>;
    const field = params.field;
    if (typeof field !== "string") continue;

    let newValue: unknown;
    if (typeof params.fromField === "string") {
      newValue = next[params.fromField];
      // Copying from a field that holds nothing sets nothing. The
      // alternative — writing undefined — would turn "we could not
      // read this" into "a rule decided it was empty", which are
      // different claims about the document.
      if (newValue === undefined) continue;
    } else {
      newValue = params.value;
    }
    if (newValue === undefined || newValue === null) continue;
    if (typeof newValue !== "string" && typeof newValue !== "number" && typeof newValue !== "boolean") {
      continue;
    }

    // Refuse rather than write a value the field's declared type
    // cannot hold. Skipping is the right failure here: the rule fired
    // correctly and the value was unusable, so the field keeps what
    // it had rather than acquiring something no operator will match.
    const coerced = coerceForField(newValue, fieldTypes[field]);
    if (coerced === undefined) continue;

    const previousValue = next[field];
    if (previousValue === coerced) continue;

    next[field] = coerced;
    overrides.push({
      ruleId,
      field,
      ...(previousValue === undefined
        ? {}
        : { previousValue: previousValue as string | number | boolean }),
      newValue: coerced,
    });
  }

  return { facts: next, overrides };
}
