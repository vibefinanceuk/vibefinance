-- 0008_environments_per_region.sql
-- Decision 0083 section 6 — one production per region, not one
-- production.
--
-- Migration 0005 introduced environments with:
--
--   UNIQUE (customer_id, kind)
--
-- and said so deliberately in its own words: "at most one sandbox and
-- one production per customer, never more, never a duplicate of
-- either." That was correct when `kind` was the only thing
-- distinguishing environments.
--
-- It is not a correction. It is a **change of intent**: a customer may
-- now hold `Morrison-EU` and `Morrison-US` productions, storing data in
-- each region while a single shared UI presents one at a time
-- (decision 0083 section 5). The narrower guarantee survives WITHIN a
-- region: a customer still cannot have two productions in the EU.
--
-- ---------------------------------------------------------------
-- Why this rebuilds four tables and not one
-- ---------------------------------------------------------------
--
-- SQLite cannot alter a UNIQUE in place, and `environments` is
-- referenced by `licences`, `usage_periods` and `signup_requests`. Two
-- narrower approaches were tried and **both failed**, which is why this
-- one is as blunt as it is.
--
-- **Dropping and recreating `environments`** fails on a populated
-- database: DROP TABLE performs an implicit DELETE that orphans every
-- referencing row, and D1 enforces foreign keys on every migration.
-- `PRAGMA defer_foreign_keys` does not save it — the DROP records a
-- deferred violation that recreating the parent afterwards never
-- clears, so COMMIT fails. `PRAGMA foreign_keys = OFF` is SQLite's own
-- answer and D1 forbids it, because every migration runs inside an
-- implicit transaction a query may not change.
--
-- **Renaming `environments` aside** fails differently, and worse
-- because it fails LATER. SQLite rewrites dependent foreign keys to
-- follow a renamed table — with or without `legacy_alter_table`,
-- checked directly. So `licences` silently came to reference
-- `environments_pre_0008`, existing rows still resolved, and every NEW
-- licence failed. The migration applied cleanly and broke the
-- application.
--
-- So: rebuild all four, in dependency order, with no renames of
-- referenced tables. Every child is recreated pointing at the new
-- parent explicitly, which is the only version whose foreign keys are
-- stated rather than inherited from whatever SQLite decided to rewrite.
PRAGMA defer_foreign_keys = on;

-- Children first, into holding tables. Copying before anything is
-- dropped means no row is ever orphaned.
CREATE TABLE _hold_licences AS SELECT * FROM licences;
CREATE TABLE _hold_usage_periods AS SELECT * FROM usage_periods;
CREATE TABLE _hold_signup_requests AS SELECT * FROM signup_requests;
CREATE TABLE _hold_environments AS SELECT * FROM environments;

DROP INDEX IF EXISTS idx_environments_customer;
DROP TABLE signup_requests;
DROP TABLE usage_periods;
DROP TABLE licences;
DROP TABLE environments;

-- The parent, with the widened constraint.
CREATE TABLE environments (
  id               TEXT PRIMARY KEY,
  customer_id      TEXT NOT NULL REFERENCES customers(id),
  kind             TEXT NOT NULL CHECK (kind IN ('sandbox', 'production')),
  region           TEXT NOT NULL,
  instance_url     TEXT NOT NULL,
  worker_name      TEXT,
  d1_database_name TEXT,
  d1_database_id   TEXT,
  locale           TEXT,
  api_key_hash     TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (customer_id, kind, region)
);

-- The children, recreated exactly as migrations 0005 and 0006 and 0007
-- left them — including `warned_at_days`, added to licences by 0007.
CREATE TABLE licences (
  environment_id      TEXT PRIMARY KEY REFERENCES environments(id),
  plan                TEXT NOT NULL,
  features_json       TEXT NOT NULL DEFAULT '[]',
  volume_entitlement  INTEGER NOT NULL,
  valid_from          TEXT NOT NULL,
  valid_to            TEXT,
  status              TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'warned', 'blocked')),
  status_reason       TEXT,
  status_effective_at TEXT,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  warned_at_days      INTEGER
);

CREATE TABLE usage_periods (
  environment_id      TEXT NOT NULL REFERENCES environments(id),
  period_key          TEXT NOT NULL,
  invoices_processed  INTEGER NOT NULL DEFAULT 0,
  rules_evaluated     INTEGER NOT NULL DEFAULT 0,
  active_users        INTEGER,
  outcome_counts_json TEXT NOT NULL DEFAULT '{}',
  received_at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (environment_id, period_key)
);

CREATE TABLE signup_requests (
  id             TEXT PRIMARY KEY,
  company_name   TEXT NOT NULL,
  contact_name   TEXT NOT NULL,
  contact_email  TEXT NOT NULL,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at   TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at     TEXT,
  decided_by     TEXT,
  customer_id    TEXT REFERENCES customers(id),
  environment_id TEXT REFERENCES environments(id)
);

-- Parent before children, so no insert is ever an orphan even for the
-- instant before the deferred check runs.
INSERT INTO environments SELECT id, customer_id, kind, region, instance_url,
  worker_name, d1_database_name, d1_database_id, locale, api_key_hash, created_at
  FROM _hold_environments;

INSERT INTO licences SELECT environment_id, plan, features_json, volume_entitlement,
  valid_from, valid_to, status, status_reason, status_effective_at, updated_at, warned_at_days
  FROM _hold_licences;

INSERT INTO usage_periods SELECT environment_id, period_key, invoices_processed,
  rules_evaluated, active_users, outcome_counts_json, received_at
  FROM _hold_usage_periods;

INSERT INTO signup_requests SELECT id, company_name, contact_name, contact_email,
  notes, status, requested_at, decided_at, decided_by, customer_id, environment_id
  FROM _hold_signup_requests;

CREATE INDEX idx_environments_customer ON environments(customer_id);

-- The holding tables reference nothing and are referenced by nothing,
-- so dropping them is safe — unlike dropping a referenced table, which
-- is what the first two attempts got wrong.
DROP TABLE _hold_signup_requests;
DROP TABLE _hold_usage_periods;
DROP TABLE _hold_licences;
DROP TABLE _hold_environments;

-- Point-in-time: nothing violates the widened rule. A count of
-- offending groups rather than a total, so it holds on an empty replay
-- database and a populated one alike.
-- ASSERT: SELECT count(*) FROM (SELECT customer_id, kind, region FROM environments GROUP BY customer_id, kind, region HAVING count(*) > 1) == 0

-- Point-in-time: no holding table survived.
-- ASSERT: SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name LIKE '\_hold\_%' ESCAPE '\' == 0

-- Point-in-time: every child still resolves to a parent. The failure
-- the first two attempts produced, asserted directly.
-- ASSERT: SELECT count(*) FROM licences WHERE environment_id NOT IN (SELECT id FROM environments) == 0
-- ASSERT: SELECT count(*) FROM usage_periods WHERE environment_id NOT IN (SELECT id FROM environments) == 0
-- ASSERT: SELECT count(*) FROM signup_requests WHERE environment_id IS NOT NULL AND environment_id NOT IN (SELECT id FROM environments) == 0

-- Standing invariant: one environment per customer, kind and region.
-- The narrower (customer_id, kind) rule from migration 0005 is
-- superseded and edited there — restating a rule in two places with one
-- of them stale is how they come to disagree.
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT customer_id, kind, region FROM environments GROUP BY customer_id, kind, region HAVING count(*) > 1) == 0

-- Standing invariants restated because this migration replaced every
-- table they were written against. An invariant that quietly stops
-- applying reads as protection while protecting nothing.
-- ASSERT ALWAYS: SELECT count(*) FROM environments WHERE customer_id NOT IN (SELECT id FROM customers) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM environments WHERE kind NOT IN ('sandbox', 'production') == 0
-- ASSERT ALWAYS: SELECT count(*) FROM environments WHERE trim(region) = '' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM environments WHERE api_key_hash = '' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM environments WHERE worker_name = '' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM environments WHERE d1_database_name = '' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM environments WHERE d1_database_id = '' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM environments WHERE locale = '' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT worker_name FROM environments WHERE worker_name IS NOT NULL GROUP BY worker_name HAVING count(*) > 1) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT d1_database_name FROM environments WHERE d1_database_name IS NOT NULL GROUP BY d1_database_name HAVING count(*) > 1) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM licences WHERE environment_id NOT IN (SELECT id FROM environments) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM licences WHERE status NOT IN ('active', 'warned', 'blocked') == 0
-- ASSERT ALWAYS: SELECT count(*) FROM usage_periods WHERE environment_id NOT IN (SELECT id FROM environments) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM usage_periods WHERE invoices_processed < 0 == 0
-- ASSERT ALWAYS: SELECT count(*) FROM usage_periods WHERE rules_evaluated < 0 == 0
