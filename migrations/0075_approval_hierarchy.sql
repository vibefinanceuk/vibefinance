-- 0075_approval_hierarchy.sql
-- Approval Hierarchy — the first of AP Setup's three tabs (decision
-- 0439), and the first of its four routing modes: Employee-Supervisor.
--
-- **The exact gap the operator named**: "A user might have a limit in
-- EUR for Acme France, but a limit in GBP for Acme UK." `org_users.
-- manager_id` (decision 0334) and `org_authority_limits` (decision
-- 0009) are both global per person — one supervisor, one limit per
-- currency, no org dimension at all.
--
-- **Additive, not a rebuild — the `stage_field_visibility_overrides`
-- shape (decision 0197), not the `org_user_roles` one (decision
-- 0199).** A unit-scoped fact here is an OVERRIDE of a global default
-- that already exists and already works, so this adds two new,
-- always-unit-scoped override tables beside the existing global ones
-- rather than rebuilding either — `org_users.manager_id` and
-- `org_authority_limits` are untouched, no data migrates, and every
-- existing reader of either keeps working exactly as it does today.
-- `unit-config.ts`'s own resolver (`unitLineage`, most-specific-wins)
-- is what a caller walks over these, the same one already serving
-- rule sets and field visibility — its own doc comment named approval
-- hierarchies as the next candidate.

-- **Who this person's supervisor is, at this org.** Unit-scoped only
-- — the group-wide default is `org_users.manager_id`, unchanged. A
-- row here is read before that default, most specific unit first.
CREATE TABLE org_user_supervisor_overrides (
  user_id       TEXT NOT NULL REFERENCES org_users(id),
  unit_id       TEXT NOT NULL REFERENCES org_units(id),
  supervisor_id TEXT NOT NULL REFERENCES org_users(id)
    CHECK (supervisor_id != user_id),
  granted_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, unit_id)
);

CREATE INDEX idx_supervisor_overrides_user ON org_user_supervisor_overrides(user_id);

-- **What this person may approve, at this org, in this currency.**
-- Same shape as above: unit-scoped only, read before the group-wide
-- default (`org_authority_limits`, unchanged).
CREATE TABLE org_authority_limit_overrides (
  user_id    TEXT NOT NULL REFERENCES org_users(id),
  unit_id    TEXT NOT NULL REFERENCES org_units(id),
  currency   TEXT NOT NULL,
  max_amount REAL NOT NULL CHECK (max_amount >= 0),
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, unit_id, currency)
);

CREATE INDEX idx_authority_limit_overrides_user ON org_authority_limit_overrides(user_id);

-- **Which mode is active, customer-wide — decision 0439's own answer
-- to "where does the choice live."** Not per-process, not per-unit:
-- one routing mode at a time, for the whole customer, the same
-- singleton shape `org_settings` already established (decision 0077).
--
-- `default_approver_user_id` is the fallback the operator asked for
-- directly: "the configuration screen should have a Default Approver,
-- which can be set if routing issues occur" — a chain with a gap (no
-- supervisor recorded, no cost centre owner) lands here rather than
-- failing the stage outright.
CREATE TABLE org_approval_config (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  mode                     TEXT NOT NULL DEFAULT 'employee_supervisor'
    CHECK (mode IN ('employee_supervisor', 'cost_object', 'manual', 'api')),
  default_approver_user_id TEXT REFERENCES org_users(id),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The row exists from the start — same reasoning as org_settings:
-- a resolver should never carry a fallback for "no config row yet."
INSERT INTO org_approval_config (id) VALUES (1);

-- **Cost-Object and Manual/API modes are named here and not built.**
-- `resolveApprovalChain` (decision 0195) already implements the walk
-- Cost-Object mode needs and is wired in — this migration only adds
-- the setting that selects it. Manual and API have no resolver at
-- all yet; selecting either falls through to the Default Approver, or
-- an explicit unresolved error where none is set. Named now so the
-- vocabulary is complete rather than grown one migration at a time,
-- the same discipline permissions.ts already applies to AP.Match and
-- AP.Code.

-- **Which stage's own `assign_task` actions resolve through the
-- configured hierarchy, instead of whatever team/user a rule names.**
-- The same shape decision 0200 already gave `required_permission`: a
-- stage-level declaration that overrides what a rule says, rather
-- than a second vocabulary a rule author could disagree with.
-- Default false, so every existing stage and every existing rule is
-- completely unaffected until an operator turns this on for the one
-- stage it belongs to — the Approval stage, reached only once
-- Validation, Matching and Coding are all complete.
ALTER TABLE process_stages ADD COLUMN uses_approval_hierarchy INTEGER NOT NULL DEFAULT 0
  CHECK (uses_approval_hierarchy IN (0, 1));

-- Point-in-time: nothing overridden yet, the config row holds its
-- default, and no stage has turned this on.
-- ASSERT: SELECT count(*) FROM org_user_supervisor_overrides == 0
-- ASSERT: SELECT count(*) FROM org_authority_limit_overrides == 0
-- ASSERT: SELECT count(*) FROM org_approval_config == 1
-- ASSERT: SELECT mode FROM org_approval_config WHERE id = 1 == 'employee_supervisor'
-- ASSERT: SELECT count(*) FROM process_stages WHERE uses_approval_hierarchy != 0 == 0

-- Standing invariant: still exactly one config row — the CHECK on the
-- primary key enforces it; restated for the same reason org_settings
-- restates it.
-- ASSERT ALWAYS: SELECT count(*) FROM org_approval_config == 1

-- Standing invariant: a supervisor override names a real user, a real
-- unit, and a real supervisor — the foreign keys already say so,
-- restated here so a reader of the migrations sees it without
-- reasoning about SQLite's own enforcement.
-- ASSERT ALWAYS: SELECT count(*) FROM org_user_supervisor_overrides WHERE user_id NOT IN (SELECT id FROM org_users) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM org_user_supervisor_overrides WHERE unit_id NOT IN (SELECT id FROM org_units) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM org_user_supervisor_overrides WHERE supervisor_id NOT IN (SELECT id FROM org_users) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM org_user_supervisor_overrides WHERE supervisor_id = user_id == 0

-- Standing invariant: an authority limit override names a real user
-- and a real unit.
-- ASSERT ALWAYS: SELECT count(*) FROM org_authority_limit_overrides WHERE user_id NOT IN (SELECT id FROM org_users) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM org_authority_limit_overrides WHERE unit_id NOT IN (SELECT id FROM org_units) == 0

-- Standing invariant: the configured Default Approver, when set, is a
-- real user.
-- ASSERT ALWAYS: SELECT count(*) FROM org_approval_config WHERE default_approver_user_id IS NOT NULL AND default_approver_user_id NOT IN (SELECT id FROM org_users) == 0

-- Standing invariant: uses_approval_hierarchy is always 0 or 1 — belt
-- and braces on top of the CHECK constraint, same pattern as
-- org_users.status in 0003.
-- ASSERT ALWAYS: SELECT count(*) FROM process_stages WHERE uses_approval_hierarchy NOT IN (0, 1) == 0
