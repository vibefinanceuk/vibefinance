-- 0321_supplier_portal_directory.sql
-- Decision 0713 — the supplier portal's directory (docs/design/supplier-portal.md,
-- Phase 1 step 1). Who a supplier's people are, and which customer's supplier
-- record and companies each may see. No invoice data: that stays in each
-- customer's instance and is read live.

-- A supplier's organisation, across every customer it is linked to.
CREATE TABLE supplier_orgs (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A person at a supplier, with their portal password. Apart from
-- user_credentials on purpose: a supplier's login is never a customer's.
CREATE TABLE portal_users (
  email           TEXT PRIMARY KEY,
  supplier_org_id TEXT NOT NULL REFERENCES supplier_orgs(id),
  password_hash   TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_portal_users_org ON portal_users(supplier_org_id);

-- What one person may see at one customer: one supplier record, for the
-- companies named (a JSON array of {"id", "name"}, never empty).
CREATE TABLE portal_links (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL REFERENCES portal_users(email),
  environment_id TEXT NOT NULL REFERENCES environments(id),
  supplier_id    TEXT NOT NULL,
  supplier_name  TEXT NOT NULL,
  org_units_json TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  created_at     TEXT NOT NULL,
  created_by     TEXT,
  invitation_id  TEXT,
  ended_at       TEXT,
  ended_by       TEXT
);
CREATE UNIQUE INDEX idx_portal_links_active ON portal_links(email, environment_id, supplier_id) WHERE status = 'active';
CREATE INDEX idx_portal_links_env_supplier ON portal_links(environment_id, supplier_id);

-- An invitation from a customer's instance: the same shape and rules as
-- staff invitations (0238), plus the supplier record and the companies.
CREATE TABLE portal_invitations (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL,
  environment_id TEXT NOT NULL REFERENCES environments(id),
  supplier_id    TEXT NOT NULL,
  supplier_name  TEXT NOT NULL,
  org_units_json TEXT NOT NULL,
  token_hash     TEXT NOT NULL UNIQUE,
  code_hash      TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired', 'spent')),
  attempts       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  created_by     TEXT,
  expires_at     TEXT NOT NULL,
  sent_at        TEXT,
  send_error     TEXT,
  accepted_at    TEXT
);
CREATE INDEX idx_portal_invitations_env_supplier ON portal_invitations(environment_id, supplier_id, email);

-- ASSERT: SELECT count(*) FROM portal_links == 0
-- ASSERT: SELECT count(*) FROM portal_invitations == 0
-- ASSERT ALWAYS: SELECT count(*) FROM portal_users WHERE email != lower(trim(email)) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM portal_links WHERE json_array_length(org_units_json) = 0 == 0
