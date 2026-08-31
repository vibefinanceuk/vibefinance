/**
 * The closed vocabulary the rule language is built from. See Blueprint,
 * "Subsystem one" — "The vocabulary is closed, and that is the feature."
 *
 * These lists are the contract between the (future) natural-language
 * compiler and this interpreter: the compiler may only ever emit
 * references found here, and this file is what "closed" means in code
 * rather than in prose. Extending it is a deliberate, reviewed change —
 * never an inferred one, and never done implicitly by the compiler.
 */

// Fields sourced directly from the EN 16931 semantic model, addressed by
// Business Term id exactly as the standard, the customer's tax adviser,
// ERP vendor and auditor already use it.
export const INVOICE_FIELDS = [
  "BT-3", // type code
  "BT-5", // currency
  "BT-2", // issue date
  "BT-9", // due date
  "BT-10", // buyer reference
  "BT-13", // purchase order ref
  "BT-31", // seller VAT id
  "BT-40", // seller country
  "BT-48", // buyer VAT id
  "BT-106", // sum of line net
  "BT-110", // total VAT
  "BT-112", // total with VAT
  "BT-115", // amount due
  "BT-129", // quantity
  "BT-131", // line net amount
  "BT-151", // VAT category
  "BT-152", // VAT rate
  "BG-20", // allowances
  "BG-21", // charges
] as const;

// Fields the platform derives — never mistaken for something the
// document itself said. Parameterised fields (term.absent) are matched
// by prefix at validation time.
export const DERIVED_FIELDS = [
  "direction",
  "party.first_document",
  "po.matched",
  "po.variance_pct",
  "mandate.channel",
  "validation.passed",
] as const;

export const DERIVED_FIELD_PREFIXES = ["term.absent("] as const;

export const OPERATORS = [
  "is",
  "is_not",
  "in",
  "not_in",
  "greater_than",
  "less_than",
  "between",
  "starts_with",
  "contains",
  "is_present",
  "is_empty",
  "older_than_days",
  "within_days",
] as const;

export const ACTIONS = [
  "route_to",
  "require_second_approval",
  "assign_cost_centre",
  "hold_until",
  "flag",
  "reject",
  "tag",
  "set_field",
  "notify",
  "escalate_after",
  "assign_task",
] as const;

export type InvoiceField = (typeof INVOICE_FIELDS)[number];
export type DerivedField = (typeof DERIVED_FIELDS)[number];
export type Operator = (typeof OPERATORS)[number];
export type ActionType = (typeof ACTIONS)[number];

// Human-readable descriptions, one source of truth reused by both the
// compiler's prompt (shared/compiler/vocabulary-doc.ts) and anywhere
// else the vocabulary needs to be explained to a person or a model.
// Kept here rather than duplicated, so a field can never describe
// itself differently in two places.
export const FIELD_DESCRIPTIONS: Record<InvoiceField, string> = {
  "BT-3": "type code (e.g. invoice vs. credit note)",
  "BT-5": "currency",
  "BT-2": "issue date",
  "BT-9": "due date",
  "BT-10": "buyer reference",
  "BT-13": "purchase order reference",
  "BT-31": "seller VAT id",
  "BT-40": "seller country",
  "BT-48": "buyer VAT id",
  "BT-106": "sum of line net amounts",
  "BT-110": "total VAT",
  "BT-112": "total with VAT",
  "BT-115": "amount due",
  "BT-129": "quantity",
  "BT-131": "line net amount",
  "BT-151": "VAT category",
  "BT-152": "VAT rate",
  "BG-20": "allowances",
  "BG-21": "charges",
};

export const DERIVED_FIELD_DESCRIPTIONS: Record<DerivedField, string> = {
  direction: "'payable' or 'receivable'",
  "party.first_document": "true if this is the first document from this party",
  "po.matched": "true if the invoice matches a purchase order",
  "po.variance_pct": "percentage variance between invoice and PO amount",
  "mandate.channel": "the e-invoicing channel/mandate this document arrived through",
  "validation.passed": "true if the document passed standard validation",
};

// Same discipline as FIELD_DESCRIPTIONS above, and for the same
// reason it turned out to matter in practice: an action with no
// documented param shape leaves the compiler to invent one on its
// own. That's exactly what happened live before this existed —
// assign_task's params were undocumented, so the model produced
// {assignee, required_permission} while the workflow engine
// (decision 0019) expected {team/user, permission}, and the mismatch
// was only caught by a real compile against a real deployment, not by
// anything in this codebase. Every action gets a real params shape
// documented here now, not just the two that happen to have real
// consumers today — the same completeness discipline as fields,
// enforced by a test, not left to be caught live again.
export const ACTION_DESCRIPTIONS: Record<ActionType, string> = {
  route_to: 'advance the process to a named stage — params: { "stage": "<stage id>" }',
  require_second_approval: "flags that this invoice needs a second approver — no params",
  assign_cost_centre: 'sets a cost centre on the invoice — params: { "value": "<cost centre>" }',
  hold_until: 'holds the invoice until a date — params: { "date": "<ISO date>" }',
  flag: "marks the invoice for attention — no params",
  reject: "rejects the invoice outright — no params",
  tag: 'attaches an arbitrary label — params: { "value": "<tag>" }',
  set_field: 'sets a field\'s value — params: { "field": "<field>", "value": <value> }',
  notify: 'sends a notification — params: { "target": "<who or what to notify>" }',
  escalate_after: 'escalates if untouched past a duration — params: { "after": "<duration, e.g. \\"2d\\">" }',
  assign_task:
    'creates a task — params: exactly one of { "team": "<team id>" } or { "user": "<user id>" }, plus { "permission": "<permission>" }',
};

export function isKnownField(field: string): boolean {
  if ((INVOICE_FIELDS as readonly string[]).includes(field)) return true;
  if ((DERIVED_FIELDS as readonly string[]).includes(field)) return true;
  return DERIVED_FIELD_PREFIXES.some(
    (prefix) => field.startsWith(prefix) && field.endsWith(")")
  );
}

export function isKnownOperator(op: string): op is Operator {
  return (OPERATORS as readonly string[]).includes(op);
}

export function isKnownAction(action: string): action is ActionType {
  return (ACTIONS as readonly string[]).includes(action);
}
