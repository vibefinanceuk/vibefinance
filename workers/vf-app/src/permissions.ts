/**
 * Permission identifiers, namespaced by business role category —
 * see docs/decisions/0010-user-authentication-and-enforcement.md.
 *
 * Structured for growth: adding a permission is a one-line addition
 * to the relevant category array below. That change never touches
 * enforce.ts (it only ever checks whatever permission string a route
 * gives it), never touches the schema (permissions_json is free-form
 * JSON), and never requires renaming anything else in this file.
 *
 * A permission may exist here before any route actually enforces it —
 * each category below says plainly which of its entries are real
 * today versus a forward-looking placeholder for functionality that
 * doesn't exist yet (AR entirely, AP.Match, AP.Code). What is NOT
 * allowed is the reverse: a route checking a permission string that
 * isn't listed here at all — that direction is what keeps this a
 * closed, reviewable vocabulary rather than free text a role could
 * grant itself. Same discipline as INVOICE_PROFILES in profiles.ts and
 * the rule interpreter's own closed vocabulary.
 */

/**
 * Accounts Payable — the side of the business this product actually
 * handles today (validating and processing invoices a customer
 * receives). Real, enforced right now: Validate, Approve, Review.
 * Not built at all yet: Match (3-way match against PO/goods receipt),
 * Code (GL coding). Analysis has real data behind it (invoice_runs in
 * D1) but no route reads it back yet, so it's listed but unenforced.
 */
const AP_PERMISSIONS = [
  "AP.Validate",
  "AP.Match",
  "AP.Code",
  "AP.Approve",
  "AP.Review",
  "AP.Analysis",
] as const;

/**
 * Accounts Receivable — the opposite side of the business (issuing
 * invoices, chasing payment). This entire category is a placeholder:
 * nothing in this system issues an invoice, sends a reminder, or runs
 * a collections workflow today. Listed now so the permission
 * vocabulary doesn't need reshaping later when that functionality
 * exists — the same "add now, unused, clearly flagged" precedent as
 * org_users.locale.
 */
const AR_PERMISSIONS = ["AR.Validate", "AR.Approve", "AR.Issue", "AR.Remind", "AR.Collect", "AR.Analysis"] as const;

/**
 * Expense management — added alongside decision 0022's expense field
 * vocabulary, the same "add now, unused, clearly flagged" precedent
 * as AR_PERMISSIONS above. No route in this system approves or
 * reviews an expense today; this exists so the permission vocabulary
 * doesn't need reshaping later when that functionality does.
 */
const EXPENSE_PERMISSIONS = ["Expense.Submit", "Expense.Approve", "Expense.Review"] as const;

/**
 * Administrative capabilities. UserManagement, ConfigManagement, and
 * RuleManagement all have real routes behind them today
 * (POST /org/users and friends; POST /org/units and /org/profiles;
 * POST /rules/compile) — though only RuleManagement is actually
 * enforced by this bundle; the /org/* routes stay deliberately
 * unauthenticated (see the decision doc's bootstrap-deadlock
 * reasoning). Configure has no specific route of its own yet — this
 * system's configuration today is entirely `wrangler.jsonc` vars, not
 * an API.
 */
const ADMIN_PERMISSIONS = [
  "Admin.Configure",
  "Admin.UserManagement",
  "Admin.ConfigManagement",
  "Admin.RuleManagement",
] as const;

/**
 * Operational, cross-cutting capabilities that don't belong to any
 * business-role category — usage reporting and the licence-refresh
 * escape hatch. Neither is enforced by any route in this bundle:
 * UsagePush isn't gated at all (see usage-route.ts's own reasoning),
 * and LicenceRefresh must never be gated, on purpose — see
 * licence-refresh-route.ts's comment on why that route has to remain
 * reachable no matter what, including a misconfigured or absent
 * authentication setup.
 */
const SYSTEM_PERMISSIONS = ["System.UsagePush", "System.LicenceRefresh"] as const;

export const PERMISSIONS = [
  ...AP_PERMISSIONS,
  ...AR_PERMISSIONS,
  ...EXPENSE_PERMISSIONS,
  ...ADMIN_PERMISSIONS,
  ...SYSTEM_PERMISSIONS,
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isKnownPermission(value: unknown): value is Permission {
  return typeof value === "string" && (PERMISSIONS as readonly string[]).includes(value);
}

/** Every element of `values` must be a known permission — used to
 * validate a role's whole permissions_json array in one call, mirroring
 * how validateRule() checks every condition/action in a rule, not just
 * the first one. */
export function isKnownPermissionList(values: unknown): values is Permission[] {
  return Array.isArray(values) && values.every(isKnownPermission);
}
