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
  "BT-1", // invoice number
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
  "BT-133", // line accounting/cost centre reference
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
  "invoice.duplicate_confidence",
] as const;

export const DERIVED_FIELD_PREFIXES = ["term.absent("] as const;

// Expense management's own field vocabulary — authored, not
// translated, per decision 0015's own framing: unlike invoice fields,
// there is no external standard (no EN 16931 equivalent) to ground
// these in, so their legitimacy has to come from this review, not an
// external document. Deliberately plain, readable names rather than
// an invented "EX-N" numbering scheme mimicking BT-* — that would
// falsely imply a standard that doesn't exist. Kept small and
// illustrative on purpose: enough to prove the vocabulary-sharing
// design generalizes to a domain with no invoice underneath it at
// all (decision 0015's "genuinely hard case"), not a comprehensive
// expense module.
export const EXPENSE_FIELDS = [
  "category",
  "amount",
  "currency",
  "submitted_date",
  "employee_id",
  "cost_centre",
  "receipt_attached",
  "trip_end_date",
  "description",
] as const;

export const EXPENSE_DERIVED_FIELDS = [
  "employee.first_submission",
  "intake.channel",
] as const;

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
export type ExpenseField = (typeof EXPENSE_FIELDS)[number];
export type ExpenseDerivedField = (typeof EXPENSE_DERIVED_FIELDS)[number];
export type Operator = (typeof OPERATORS)[number];
export type ActionType = (typeof ACTIONS)[number];

// Human-readable descriptions, one source of truth reused by both the
// compiler's prompt (shared/compiler/vocabulary-doc.ts) and anywhere
// else the vocabulary needs to be explained to a person or a model.
// Kept here rather than duplicated, so a field can never describe
// itself differently in two places.
export const FIELD_DESCRIPTIONS: Record<InvoiceField, string> = {
  "BT-1": "the supplier's own invoice number",
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
  "BT-133": "the accounting/cost centre reference for this line — where this cost gets booked in the buyer's own financial accounts. A genuinely separate concept from org_units (decision 0009): a financial/accounting construct, not an organizational/authority one — the two are not guaranteed to correspond 1:1.",
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
  // Enriched with real example values, per decision 0023's "Intake"
  // convention — a free string, deliberately not a closed enum (see
  // that decision for why enforcement was explicitly declined). The
  // examples below are illustrative, shown to the compiler's own
  // model via this same description, not an exhaustive or enforced
  // list.
  "mandate.channel":
    "the channel this document arrived through. AP examples: Email, Mailroom, EDI, Tax Authority, Supplier Portal. AR examples: Billing System A, Billing System B, Order Fulfillment A, Order Fulfillment B. A free string, not a closed enum.",
  "validation.passed": "true if the document passed standard validation",
  "invoice.duplicate_confidence":
    "a weighted score from 0.0 to 1.0 estimating how likely this invoice is to duplicate another already on file from the same supplier — computed from an exact match on invoice number (60%), total amount (25%), and issue date (15%); zero if the supplier doesn't match at all. Not a boolean — compare it against whatever threshold a rule chooses with greater_than.",
};

export const EXPENSE_FIELD_DESCRIPTIONS: Record<ExpenseField, string> = {
  category: "the expense category, e.g. Travel, Meals, Software, Office Supplies",
  amount: "the expense amount",
  currency: "the currency the amount is in",
  submitted_date: "the date the expense was submitted for reimbursement",
  employee_id: "the id of the employee who submitted the expense",
  cost_centre: "the cost centre this expense should be charged against",
  receipt_attached: "true if a receipt was attached to the submission",
  trip_end_date: "the end date of the trip this expense relates to, if any",
  description: "a free-text description of the expense",
};

export const EXPENSE_DERIVED_FIELD_DESCRIPTIONS: Record<ExpenseDerivedField, string> = {
  "employee.first_submission": "true if this is the first expense this employee has ever submitted",
  // mandate.channel's own expense-domain equivalent — a differently
  // named field rather than reusing mandate.channel across
  // vocabularies, since "mandate" is an e-invoicing-specific term
  // with no meaning for an expense submission. Free string, not a
  // closed enum, matching mandate.channel's own choice. A mobile app
  // is a real anticipated channel, not yet built — listed as an
  // example the same "add now, clearly flagged, unbacked" precedent
  // already used for AR_PERMISSIONS and Expense.* before either had a
  // real route behind it.
  "intake.channel":
    "how this expense was submitted — e.g. Manual Entry, iPhone App (a future channel, not yet built), Corporate Card Feed. A free string, not a closed enum.",
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

// A closed set of named vocabularies — the real infrastructure
// decision 0015 flagged as necessary before a second domain could
// exist at all: "validateRule(), isKnownField()... currently check
// against ONE global, module-level vocabulary. This has to become
// parameterized." Operators and actions stay shared across every
// vocabulary (confirmed empirically, not just assumed, by decision
// 0021's AR test) — only field lists vary per domain, which is all
// this registry actually holds.
export const VOCABULARIES = {
  invoice: {
    fields: INVOICE_FIELDS as readonly string[],
    fieldDescriptions: FIELD_DESCRIPTIONS as Record<string, string>,
    derivedFields: DERIVED_FIELDS as readonly string[],
    derivedFieldDescriptions: DERIVED_FIELD_DESCRIPTIONS as Record<string, string>,
  },
  expense: {
    fields: EXPENSE_FIELDS as readonly string[],
    fieldDescriptions: EXPENSE_FIELD_DESCRIPTIONS as Record<string, string>,
    derivedFields: EXPENSE_DERIVED_FIELDS as readonly string[],
    derivedFieldDescriptions: EXPENSE_DERIVED_FIELD_DESCRIPTIONS as Record<string, string>,
  },
} as const;

export const VOCABULARY_NAMES = Object.keys(VOCABULARIES) as VocabularyName[];
export type VocabularyName = keyof typeof VOCABULARIES;

export function isKnownVocabulary(name: string): name is VocabularyName {
  return name in VOCABULARIES;
}

// Defaults to 'invoice' — every existing caller written before
// vocabularies existed at all continues checking exactly what it
// always checked, unchanged. Only a caller that explicitly asks for
// 'expense' sees the new field list.
export function isKnownField(field: string, vocabulary: VocabularyName = "invoice"): boolean {
  const v = VOCABULARIES[vocabulary];
  if (v.fields.includes(field)) return true;
  if (v.derivedFields.includes(field)) return true;
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
