import type { InvoiceFacts, RuleAction } from "@vibefinance/shared";

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
export function applySetFieldActions(
  facts: InvoiceFacts,
  actions: readonly RuleAction[],
  ruleId: string
): SetFieldOutcome {
  const next: InvoiceFacts = { ...facts };
  const overrides: FieldOverride[] = [];

  for (const action of actions) {
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

    const previousValue = next[field];
    if (previousValue === newValue) continue;

    next[field] = newValue;
    overrides.push({
      ruleId,
      field,
      ...(previousValue === undefined
        ? {}
        : { previousValue: previousValue as string | number | boolean }),
      newValue,
    });
  }

  return { facts: next, overrides };
}
