-- 0078_matching_exceptions_and_business_user.sql
-- Two-Way Matching Exceptions and Business User Collaboration — the
-- schema half of decisions 0464-0469. Zero behaviour change on
-- deploy: every new setting defaults to exactly what already happens
-- today, and nothing routes, matches, or grants access differently
-- until an operator turns something on deliberately.

-- **The Person Reference the operator asked for by name**: "I foresee
-- that a Person Reference field would need to be added to the PO
-- information that we hold, that should be an actual person in the
-- users database." Nullable — most purchase orders loaded before this
-- exists will have none, and nothing requires one to keep matching
-- working exactly as it does today (decision 0468 — this column is a
-- sensible default to pre-fill "add to conversation" with, not an
-- access gate on its own).
ALTER TABLE purchase_orders ADD COLUMN buyer_user_id TEXT REFERENCES org_users(id);

-- **"Add person to conversation" — decision 0468's own replacement for
-- a derived-ownership access check.** Genuinely new storage, the same
-- shape `document_comments` (0059) already is: new information with
-- no other source to derive it from. Composite primary key, the same
-- "no duplicate grant" shape `org_user_supervisor_overrides` (0075)
-- already uses — adding the same person twice is a no-op, not two
-- rows to reconcile.
CREATE TABLE invoice_collaborators (
  invoice_id TEXT NOT NULL REFERENCES invoice_headers(id),
  user_id    TEXT NOT NULL REFERENCES org_users(id),
  added_by   TEXT NOT NULL REFERENCES org_users(id),
  added_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (invoice_id, user_id)
);

CREATE INDEX idx_invoice_collaborators_invoice ON invoice_collaborators(invoice_id);
CREATE INDEX idx_invoice_collaborators_user ON invoice_collaborators(user_id);

-- **An org-wide default tolerance, superseded by the supplier-specific
-- one when set** — the operator's own words. Singleton, the same
-- shape `org_approval_config` (0075) already is. Defaults preserve
-- today's actual behaviour exactly, not a fresh policy choice:
-- `po-matching.ts` already treats an unset supplier tolerance as `0`
-- (`?? 0`), so a `0` org default changes nothing for any supplier
-- without one, the day this migration applies.
-- `quantity_matching_enabled` defaults **on** for the same reason —
-- quantity is already compared unconditionally today wherever a
-- quantity exists on both sides; this makes that switchable without
-- silently turning it off for anyone.
CREATE TABLE org_matching_config (
  id                        INTEGER PRIMARY KEY CHECK (id = 1),
  amount_tolerance_pct      REAL NOT NULL DEFAULT 0 CHECK (amount_tolerance_pct >= 0),
  quantity_tolerance_pct    REAL NOT NULL DEFAULT 0 CHECK (quantity_tolerance_pct >= 0),
  quantity_matching_enabled INTEGER NOT NULL DEFAULT 1 CHECK (quantity_matching_enabled IN (0, 1)),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO org_matching_config (id) VALUES (1);

-- **Non-PO Approval routing — additive, alongside the existing four
-- modes, not a fifth value replacing them.** `org_approval_config.mode`
-- is one customer-wide choice between Employee-Supervisor and
-- Cost-Object; whether a Non-PO invoice routes to its own requester is
-- a separate question `resolveApprovalHierarchy` checks *before*
-- dispatching to whichever mode is configured, the same "additive,
-- nothing existing had to change shape" discipline decision 0452's own
-- `costObjectValues` already set. Default off: a customer already
-- relying on Employee-Supervisor or Cost-Object routing for their
-- Non-PO invoices sees no change until this is turned on deliberately.
ALTER TABLE org_approval_config ADD COLUMN route_non_po_to_requester INTEGER NOT NULL DEFAULT 0
  CHECK (route_non_po_to_requester IN (0, 1));

-- Point-in-time: no PO has a buyer yet, no invoice has a collaborator
-- yet, the matching config row holds its defaults, and the approval
-- config's new column holds its default.
-- ASSERT: SELECT count(*) FROM purchase_orders WHERE buyer_user_id IS NOT NULL == 0
-- ASSERT: SELECT count(*) FROM invoice_collaborators == 0
-- ASSERT: SELECT count(*) FROM org_matching_config == 1
-- ASSERT: SELECT amount_tolerance_pct FROM org_matching_config WHERE id = 1 == 0
-- ASSERT: SELECT quantity_tolerance_pct FROM org_matching_config WHERE id = 1 == 0
-- ASSERT: SELECT quantity_matching_enabled FROM org_matching_config WHERE id = 1 == 1
-- ASSERT: SELECT route_non_po_to_requester FROM org_approval_config WHERE id = 1 == 0

-- Standing invariant: a PO's own buyer, when set, is a real user —
-- the foreign key already says so, restated so a reader of the
-- migrations sees it without reasoning about SQLite's own enforcement,
-- the same discipline 0075 already established.
-- ASSERT ALWAYS: SELECT count(*) FROM purchase_orders WHERE buyer_user_id IS NOT NULL AND buyer_user_id NOT IN (SELECT id FROM org_users) == 0

-- Standing invariant: a collaborator row names a real invoice, a real
-- user, and a real person who added them.
-- ASSERT ALWAYS: SELECT count(*) FROM invoice_collaborators WHERE invoice_id NOT IN (SELECT id FROM invoice_headers) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM invoice_collaborators WHERE user_id NOT IN (SELECT id FROM org_users) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM invoice_collaborators WHERE added_by NOT IN (SELECT id FROM org_users) == 0

-- Standing invariant: still exactly one matching config row — the
-- CHECK on the primary key enforces it; restated for the same reason
-- org_approval_config's own singleton is restated in 0075.
-- ASSERT ALWAYS: SELECT count(*) FROM org_matching_config == 1

-- Standing invariant: neither tolerance percentage is ever negative —
-- the CHECK already enforces it, restated the same doubled-up way
-- cost_centres.approval_limit's own non-negative check already is.
-- ASSERT ALWAYS: SELECT count(*) FROM org_matching_config WHERE amount_tolerance_pct < 0 == 0
-- ASSERT ALWAYS: SELECT count(*) FROM org_matching_config WHERE quantity_tolerance_pct < 0 == 0

-- Standing invariant: quantity_matching_enabled and
-- route_non_po_to_requester are always 0 or 1 — belt and braces on top
-- of their CHECK constraints, the same pattern org_users.status
-- established in 0003.
-- ASSERT ALWAYS: SELECT count(*) FROM org_matching_config WHERE quantity_matching_enabled NOT IN (0, 1) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM org_approval_config WHERE route_non_po_to_requester NOT IN (0, 1) == 0

-- **The closed set, in two places — decision 0200, restated with
-- Procurement.Collaborate and Procurement.Approve now added.**
-- process_stages.required_permission accepts any text, checked only by
-- this standing invariant, already restated by migrations 0062, 0063,
-- 0066, 0071, and 0074 as the permission vocabulary grew. Restated
-- again here with the vocabulary as it now stands (permissions.ts's own
-- PERMISSIONS array), rather than editing any earlier, already-applied
-- migration in place. Neither Procurement permission has a real route
-- yet — reserved, the same as AP.Match — but decisions 0071/0074 both
-- already established that a permission belongs in this list from the
-- moment it exists in code, real route or not.
-- ASSERT ALWAYS: SELECT count(*) FROM process_stages WHERE required_permission IS NOT NULL AND required_permission NOT IN ('AP.Analysis','AP.Approve','AP.Assistant','AP.Code','AP.Dashboard','AP.Discard','AP.FraudReview','AP.Match','AP.Return','AP.ReturnAny','AP.ReturnToSupplier','AP.Review','AP.Supplier','AP.TaskManage','AP.TaskView','AP.Validate','AR.Analysis','AR.Approve','AR.Collect','AR.Issue','AR.Remind','AR.Validate','Admin.ConfigManagement','Admin.Configure','Admin.RoleManagement','Admin.RuleActivation','Admin.RuleManagement','Admin.UserManagement','Expense.Approve','Expense.Review','Expense.Submit','Procurement.Approve','Procurement.Collaborate','Supplier.Maintain','System.LicenceRefresh','System.UsagePush') == 0
