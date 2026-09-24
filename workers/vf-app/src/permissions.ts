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
 * receives). Real, enforced right now: Validate, Approve, Review,
 * Dashboard, TaskView, Supplier, and — since decisions 0455/0456 — Code
 * (GL coding; widened onto document-open, task-search, key-fields and
 * activity/comment routes alongside AP.Validate). **Still not built:
 * Match (2-way match against a purchase order)** — the vocabulary and
 * schema for matching exceptions exist as of decisions 0464-0469, but
 * no route yet accepts `AP.Match` the way those routes accept
 * `AP.Code`; that route-widening is its own later phase, per decision
 * 0466's own note that it should get the same treatment. Analysis has
 * real data behind it (invoice_runs in D1) but no route reads it back
 * yet, so it's listed but unenforced.
 */
const AP_PERMISSIONS = [
  "AP.Validate",
  "AP.Match",
  "AP.Code",
  "AP.Approve",
  "AP.Review",
  "AP.Analysis",
  /**
   * **Three added for menu visibility, decision 0276** — the
   * operator's own instruction to underpin the nav with real
   * permissions ahead of a future Role permissions screen: "now seems
   * like a sensible time to underpin with some kind of role, menu
   * mapping so that we can control who sees certain menus."
   *
   * Each gates both a nav item and the route the screen behind it
   * calls — `AP.Dashboard` for `GET /dashboard`, `AP.TaskView` for
   * `GET /tasks`, `AP.Supplier` for `GET /suppliers` (and its own
   * writes — see suppliers-route.ts). None of the three existed
   * before this: those routes checked only that somebody was
   * authenticated, which was a real, deliberate choice at the time
   * (`/tasks`' own comment still explains why row-level scoping was
   * enough on its own) — this adds a screen-level gate in front of
   * that scoping, not a replacement for it.
   *
   * `AP.TaskView` is deliberately not `AP.TaskManage` — that already
   * exists, and grants the more privileged capability of releasing or
   * seeing every user's tasks (decision 0104). Seeing your own task
   * list at all is a lesser, more basic thing to be able to do.
   */
  "AP.Dashboard",
  "AP.TaskView",
  "AP.Supplier",
  // Returning — decision 0075. Two shapes, deliberately.
  //
  // Return and ReturnToSupplier are capability MODIFIERS: they activate
  // returning wherever the holder already has standing, checked against
  // the task's own required_permission, and nowhere else. Someone with
  // AP.Return and AP.Review can return from Review and not from
  // Approval, because they have no business at Approval regardless.
  //
  // ReturnAny is the opposite — it grants standing the holder does not
  // otherwise have, on a task somebody else holds. A manager override.
  // It overrides OWNERSHIP, not destination: sending a document to its
  // supplier still requires AP.ReturnToSupplier, manager or not.
  "AP.Return",
  "AP.ReturnToSupplier",
  "AP.ReturnAny",
  // Discarding — decision 0078. The third outcome for a document a
  // person cannot process, and deliberately not the same permission as
  // keying: keying introduces facts, discarding closes the matter.
  // Somebody trusted to transcribe an amount is not automatically
  // somebody who should decide an invoice never needs looking at again.
  "AP.Discard",
  // Releasing somebody else's claim, and seeing every user's tasks —
  // decision 0104. Deliberately not AP.ReturnAny: that returns a
  // DOCUMENT to a previous stage, and the document moves. Unlocking
  // leaves the task exactly where it is and merely makes it available
  // again. Bundling them would mean anybody who can unlock a task can
  // also send documents backwards through the workflow.
  "AP.TaskManage",
  /**
   * **Reserved since decision 0417, real since decision 0420.** The
   * Management Dashboard design's own Fraud & Risk Detection screen is
   * the one screen that document explicitly recommends a new
   * permission for, rather than riding on `AP.Analysis`: *"fraud/risk
   * data is more sensitive than ordinary throughput or spend data and
   * deserves its own gate."* Decision 0420 gave it its first real
   * consumer, `GET /fraud/duplicates` — nobody is granted this by any
   * migration; who holds it is an operator decision made through the
   * Access screen, not this codebase's.
   */
  "AP.FraudReview",
  /**
   * **Reserved since decision 0426, real since decision 0430.** The
   * Management Dashboard design's own Screen 6, "Talk to an AP
   * Expert" — a conversational tab answering plain-language questions
   * over live AP data. The design's own words, quoted directly: *"a
   * new, dedicated `AP.Assistant` permission — deliberately not
   * implied by any existing grant, since this is the one screen that
   * answers open-ended questions rather than rendering a fixed,
   * reviewed report."*
   *
   * **Gates the chat itself, not the data.** Holding this alone
   * answers nothing: every tool the assistant can call is additionally
   * gated by that tool's own real permission (`AP.Supplier`,
   * `AP.Analysis`) at call time, exactly the design's own Role-Based
   * Access Model row for this screen — *"each tool call runs through
   * the same `hasPermission`/`unitClause` checks as the screen it
   * stands in for"* — so a person's chat answers are scoped exactly
   * the way their screens already are, never more.
   */
  "AP.Assistant",
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
 * **A real route behind it from the start — decision 0350.** Unlike
 * AR_PERMISSIONS and EXPENSE_PERMISSIONS above, this is not the
 * "add now, unused, clearly flagged" placeholder precedent: the
 * Supplier Maintenance stage's own rule assigns a task requiring
 * this permission the moment it is seeded, so a person needs to
 * actually hold it to claim one.
 *
 * A separate namespace from `AP.Supplier` ("view and manage
 * suppliers," the mirror screen itself), matching decision 0333's
 * own "namespaced by business role, not by route": validating a new
 * or changed supplier record is its own business function, not AP
 * work that happened to touch a supplier.
 */
const SUPPLIER_MAINTENANCE_PERMISSIONS = ["Supplier.Maintain"] as const;

/**
 * **Business User — decision 0468, reserved, no route enforces either
 * yet.** A Business User is not AP staff: someone who requested goods
 * or services (on a PO or off it) and needs a narrow way in, not the
 * run of AP.* permissions. Split into two, the same way this codebase
 * already splits `AP.Validate` from `AP.Approve` rather than one blob:
 *
 * - `Procurement.Collaborate` — view an invoice you were explicitly
 *   added to (via "Add person to conversation") and post to its chat.
 *   Deliberately not derived from PO ownership; `invoice_collaborators`
 *   is what this checks once a route exists.
 * - `Procurement.Approve` — hold and complete an approval task, the
 *   operator's own example being a Non-PO invoice routed to its
 *   requester.
 *
 * Grantable independently or together, like any other role. A separate
 * namespace from `AP.*`, the same "namespaced by business role, not by
 * route" reasoning `Supplier.Maintain` above already follows — this is
 * a business user's own function, not AP work that happened to touch
 * an invoice.
 */
const PROCUREMENT_PERMISSIONS = ["Procurement.Collaborate", "Procurement.Approve"] as const;

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
 * reasoning).
 *
 * **`Admin.Configure` is the one routes actually use** — twenty-two of
 * them, covering sources, ledgers, cost centres and the supplier load.
 * The note that once said it had "no specific route of its own yet" was
 * true when written and has not been for months.
 *
 * **`Admin.ConfigManagement` is used by nothing**, and is the kind of
 * placeholder decision 0010 warned about: *"several permissions in this
 * scheme are placeholders today, unbacked by any real route."*
 *
 * Two names a permission could plausibly have is one too many, and
 * decision 0215 chose one route wrongly because of it. **Not removed
 * here**: a permission a customer may already have granted is not
 * something to delete in passing.
 */
const ADMIN_PERMISSIONS = [
  "Admin.Configure",
  "Admin.UserManagement",
  "Admin.ConfigManagement",
  "Admin.RuleManagement",
  /**
   * **Activating a rule, its own real permission** — decision 0325,
   * reported live: "there should be a specific permission for
   * activating rules." Genuinely distinct from `Admin.RuleManagement`
   * above (compiling, reading, renaming — never activation) and from
   * what its own former gate's name implied: `AP.Approve` sounds like
   * approving an invoice, and never gated that anywhere in this
   * bundle — invoice approval is a task's own `required_permission`,
   * a separate, data-driven mechanism this never touched. Replaces
   * `AP.Approve` on the one route that checked it, rather than
   * sitting alongside it, at the operator's own request.
   */
  "Admin.RuleActivation",
  /**
   * **Editing what a role itself means — decision 0326.** Genuinely
   * distinct from `Admin.RuleManagement` (rule definitions) and from
   * `Admin.UserManagement` (deliberately delegable, decision 0201 —
   * assigning an *existing* role to a person at one org). This one is
   * not: changing what a role grants is instance-wide by nature —
   * "AP Manager" means the same thing everywhere it is held, and a
   * delegated administrator scoped to one org has no boundary that
   * would make editing it safe to delegate. Deliberately named
   * "Role", not "Rule" — easy to mis-type as the existing permission
   * two lines above, and worth the caution that cost this session
   * real time to catch once already.
   */
  "Admin.RoleManagement",
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
  ...SUPPLIER_MAINTENANCE_PERMISSIONS,
  ...PROCUREMENT_PERMISSIONS,
  ...ADMIN_PERMISSIONS,
  ...SYSTEM_PERMISSIONS,
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * **A short, human description for every permission — decision 0331.**
 * Reported live: "the Permissions are sometimes a little difficult to
 * understand what capability is provisioned." Sourced directly from
 * this file's own comments above, not invented — the same discipline
 * that keeps `PERMISSIONS` itself a closed vocabulary applies here:
 * a description drifting from what a permission actually gates would
 * be worse than no description at all, so this is one more thing kept
 * beside the single source of truth rather than duplicated into the
 * frontend by hand.
 *
 * A `Record<Permission, string>` rather than a parallel array: the
 * type system itself refuses a description for a permission that
 * doesn't exist, and refuses a build missing one for a permission
 * that does — the same protection `isKnownPermissionList` gives the
 * vocabulary itself, extended to cover this.
 */
export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  "AP.Validate": "Confirm or correct an invoice's data at the Validation stage",
  "AP.Match": "Two-way match against a purchase order — reserved; no route accepts it yet, unlike AP.Code",
  "AP.Code": "Assign GL/cost-centre coding to an invoice — the document-open, task-search, key-fields and activity routes accept it alongside AP.Validate",
  "AP.Approve": "Approve an invoice for payment",
  "AP.Review": "Review an invoice at the Review stage",
  "AP.Analysis": "See the AP Analytics screen's Operational and Financial Performance tabs",
  "AP.Dashboard": "See the Dashboard screen",
  "AP.TaskView": "See your own task list",
  "AP.Supplier": "View and manage suppliers, and the AP Analytics screen's Supplier Performance tab",
  "AP.Return": "Return an invoice to an earlier stage you already work",
  "AP.ReturnToSupplier": "Send an invoice back to the supplier",
  "AP.ReturnAny": "Return any invoice, even one someone else owns",
  "AP.Discard": "Discard a document that cannot be processed",
  "AP.FraudReview": "See the AP Analytics screen's Fraud Prevention tab",
  "AP.TaskManage": "See and release every user's tasks, not just your own",
  "AP.Assistant": "Ask the AP Analytics screen's Talk to an AP Expert tab a question — each answer still scoped by whatever else you hold",

  "AR.Validate": "Accounts Receivable — not yet built",
  "AR.Approve": "Accounts Receivable — not yet built",
  "AR.Issue": "Accounts Receivable — not yet built",
  "AR.Remind": "Accounts Receivable — not yet built",
  "AR.Collect": "Accounts Receivable — not yet built",
  "AR.Analysis": "Accounts Receivable — not yet built",

  "Expense.Submit": "Expense management — not yet built",
  "Expense.Approve": "Expense management — not yet built",
  "Expense.Review": "Expense management — not yet built",

  "Supplier.Maintain": "Validate a new or changed supplier record",

  "Procurement.Collaborate": "View an invoice you've been added to, and post to its chat — reserved, no route yet",
  "Procurement.Approve": "Hold and complete an approval task, e.g. a Non-PO invoice routed to its requester — reserved, no route yet",

  "Admin.Configure": "Configure sources, ledgers, cost centres, and other setup screens",
  "Admin.UserManagement": "Create people, and assign or revoke their roles",
  "Admin.ConfigManagement": "Not used by any screen today",
  "Admin.RuleManagement": "Compile, read, and rename rules",
  "Admin.RuleActivation": "Activate a compiled rule so it takes effect",
  "Admin.RoleManagement": "Create and edit what a role itself grants",

  "System.UsagePush": "Not enforced by any route",
  "System.LicenceRefresh": "Not enforced by any route — a deliberate escape hatch",
};

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
