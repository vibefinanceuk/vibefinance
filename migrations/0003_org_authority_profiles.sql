-- 0003_org_authority_profiles.sql
-- Blueprint's org/authority/profiles subsystem: a customer's own
-- organisational structure, individual people (not authenticated yet
-- — no credential or session concept exists anywhere in this system;
-- this is data only), role-based permission containers, per-user
-- monetary approval ceilings, and which CIUS profile(s) a customer
-- actually issues/receives invoices under. See
-- docs/decisions/0009-org-authority-profiles.md for the full scope
-- decision — this bundle is schema plus a minimal CRUD API, no
-- authentication and no permission enforcement.
--
-- Lives in vf-app-poc, not vf-licence-poc: this is a customer's own
-- organisational content, not cross-customer control-plane data — the
-- same trust boundary as every other table in this file
-- (docs/decisions/0001-worker-split-and-tenant-resolution.md).
--
-- Same assertion syntax as 0001_rule_engine_schema.sql — see that
-- file's header comment for the full explanation.

-- A customer's own org structure. Optionally hierarchical — a
-- subsidiary can belong to a division which belongs to the top-level
-- organisation. NULL parent_unit_id means "top-level", not an error.
CREATE TABLE org_units (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  parent_unit_id TEXT REFERENCES org_units(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_org_units_parent ON org_units(parent_unit_id);

-- Real individual people. Deliberately no credential, password, or
-- session field — authentication is explicitly out of scope for this
-- bundle (see the decision doc). unit_id is nullable: a very small
-- customer might have people but no sub-structure worth naming yet.
CREATE TABLE org_users (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  unit_id    TEXT REFERENCES org_units(id),
  -- Ready for the day real per-user sessions exist and locale can come
  -- from the authenticated user rather than the whole deployment's
  -- LOCALE var (docs/decisions/0008-locale-aware-messages.md) —
  -- nothing reads this column yet. NULL means "use the deployment
  -- default", the same fallback behaviour resolveLocale() already has.
  locale     TEXT,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_org_users_unit ON org_users(unit_id);

-- Named permission containers. The NAME is customer-definable (a
-- customer might call one "Regional AP Manager") — but every
-- permission it grants must come from a closed, code-defined
-- vocabulary (workers/vf-app/src/permissions.ts), validated at the
-- application layer before insert, the same discipline the rule
-- interpreter already applies to its own closed vocabulary. Not
-- enforced against a SQL CHECK here, unlike org_profiles' cius_profile
-- below — permissions_json is a JSON array, not a single enum value a
-- CHECK constraint can validate directly.
CREATE TABLE org_roles (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  permissions_json TEXT NOT NULL DEFAULT '[]',
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Many-to-many: a person can hold more than one role.
CREATE TABLE org_user_roles (
  user_id TEXT NOT NULL REFERENCES org_users(id),
  role_id TEXT NOT NULL REFERENCES org_roles(id),
  PRIMARY KEY (user_id, role_id)
);

-- Per-user, per-currency approval ceilings — the real AP concept
-- "this person can approve up to X; above that, escalate." Composite
-- key, not user_id alone: a person can reasonably hold different
-- limits in different currencies (a US-based reviewer with a USD
-- limit and separately a EUR limit for European invoices).
CREATE TABLE org_authority_limits (
  user_id    TEXT NOT NULL REFERENCES org_users(id),
  currency   TEXT NOT NULL,
  max_amount REAL NOT NULL CHECK (max_amount >= 0),
  PRIMARY KEY (user_id, currency)
);

-- Which CIUS (Core Invoice Usage Specification) profile(s) this
-- customer, or one of its units, actually issues/receives invoices
-- under. "BIS" (Business Interoperability Specification) is Peppol's
-- own branded synonym for CIUS — Peppol BIS Billing 3.0 IS a CIUS of
-- EN 16931, not a separate thing. unit_id is nullable: NULL means
-- "applies to the whole organisation by default"; a specific unit_id
-- lets different subsidiaries operate under different national
-- profiles.
--
-- The CHECK below is a deliberately SMALL, explicitly non-exhaustive
-- starting set — confirmed real and currently correctly named against
-- independent sources at the time this was written, not exhaustive
-- against the full, evolving OpenPeppol/CEN registry, which is
-- updated on its own release cycle (a November 2025 Peppol BIS
-- release was the most current confirmed at the time of writing).
-- Extending this list is a normal, expected future migration, not a
-- sign something here was wrong.
CREATE TABLE org_profiles (
  id           TEXT PRIMARY KEY,
  cius_profile TEXT NOT NULL CHECK (cius_profile IN (
    'peppol_bis_billing_3', 'xrechnung', 'factur_x', 'fatturapa', 'en16931_base'
  )),
  unit_id      TEXT REFERENCES org_units(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Point-in-time: every table here exists and is empty at the moment
-- this migration finishes.
-- ASSERT: SELECT count(*) FROM org_units == 0
-- ASSERT: SELECT count(*) FROM org_users == 0
-- ASSERT: SELECT count(*) FROM org_roles == 0
-- ASSERT: SELECT count(*) FROM org_authority_limits == 0
-- ASSERT: SELECT count(*) FROM org_profiles == 0

-- Standing invariant: a unit's parent, when set, is always a real unit.
-- ASSERT ALWAYS: SELECT count(*) FROM org_units WHERE parent_unit_id IS NOT NULL AND parent_unit_id NOT IN (SELECT id FROM org_units) == 0

-- Standing invariant: a user's unit, when set, is always a real unit.
-- ASSERT ALWAYS: SELECT count(*) FROM org_users WHERE unit_id IS NOT NULL AND unit_id NOT IN (SELECT id FROM org_units) == 0

-- Standing invariant: every role assignment references a real user and a real role.
-- ASSERT ALWAYS: SELECT count(*) FROM org_user_roles WHERE user_id NOT IN (SELECT id FROM org_users) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM org_user_roles WHERE role_id NOT IN (SELECT id FROM org_roles) == 0

-- Standing invariant: every authority limit references a real user.
-- ASSERT ALWAYS: SELECT count(*) FROM org_authority_limits WHERE user_id NOT IN (SELECT id FROM org_users) == 0

-- Standing invariant: an org_profiles row's unit, when set, is always a real unit.
-- ASSERT ALWAYS: SELECT count(*) FROM org_profiles WHERE unit_id IS NOT NULL AND unit_id NOT IN (SELECT id FROM org_units) == 0

-- Standing invariant: org_users.status is always one the application
-- code understands — belt-and-braces on top of the CHECK constraint,
-- same pattern as rule_sets.mode in 0001_rule_engine_schema.sql.
-- ASSERT ALWAYS: SELECT count(*) FROM org_users WHERE status NOT IN ('active', 'disabled') == 0
