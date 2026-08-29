-- 0001_rule_engine_schema.sql
-- Rule engine tables from the Blueprint, "Subsystem one": rule_sets,
-- rules, rule_versions, rule_examples, invoice_runs, invoice_run_steps.
--
-- Assertion syntax (see migrations/apply_migrations.py and §6 of the
-- change-and-promotion model):
--   -- ASSERT: <query> <op> <expected>        -- checked once, right here
--   -- ASSERT ALWAYS: <query> <op> <expected> -- re-checked at the end of
--                                                every replay, forever
-- The parser splits each assertion line on the RIGHTMOST comparison
-- operator (==, !=, >=, <=, >, <). Any comparison operator that is part
-- of the query itself, not the assertion, must be wrapped in a subquery
-- so it cannot be mistaken for the split point.
-- Standing invariants are phrased as "no row violates X", never as an
-- exact row count — the next legitimate insert must not force an edit
-- to an already-applied migration.

CREATE TABLE rule_sets (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  -- first_match or all_matches — declared per set, never inferred.
  -- Two customers with the same rules in a different order get
  -- different answers, and both are correct (Blueprint, rule_sets).
  mode   TEXT NOT NULL CHECK (mode IN ('first_match', 'all_matches')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived'))
);

CREATE TABLE rules (
  id          TEXT PRIMARY KEY,
  rule_set_id TEXT NOT NULL REFERENCES rule_sets(id),
  -- Evaluation order is explicit, not insertion order.
  sort_order  INTEGER NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

CREATE INDEX idx_rules_rule_set_id ON rules(rule_set_id);

-- Append-only: a row is written once and never updated, except for
-- approved_by / approved_at / effective_to being filled in later.
CREATE TABLE rule_versions (
  rule_id       TEXT NOT NULL REFERENCES rules(id),
  version       INTEGER NOT NULL,
  -- The sentence the customer wrote. What they maintain and re-read;
  -- not a comment.
  source_text   TEXT NOT NULL,
  -- What actually executes. Validated against the vocabulary schema
  -- (shared/interpreter/evaluate.ts, validateRule) before it can be
  -- stored — that validation happens in application code, not SQL;
  -- this column is the already-validated result.
  compiled_json TEXT NOT NULL,
  -- Model and version. When a compiler upgrade changes behaviour you
  -- need to know which rules it wrote.
  compiled_by   TEXT NOT NULL,
  -- A person activated this. Never auto-promote a generated rule.
  approved_by   TEXT,
  approved_at   TEXT,
  effective_from TEXT,
  effective_to   TEXT,
  PRIMARY KEY (rule_id, version)
);

CREATE TABLE rule_examples (
  id              TEXT PRIMARY KEY,
  rule_id         TEXT NOT NULL,
  rule_version    INTEGER NOT NULL,
  -- A worked example the model generated when it drafted the rule.
  invoice_json    TEXT NOT NULL,
  -- Should this rule fire on it, or not? Both directions matter.
  expect_match    INTEGER NOT NULL CHECK (expect_match IN (0, 1)),
  -- The customer said yes, this is what I meant.
  confirmed_by    TEXT,
  FOREIGN KEY (rule_id, rule_version) REFERENCES rule_versions(rule_id, version)
);

-- Append-only execution log — the support argument from the Blueprint:
-- any customer problem reproduces from two inputs, their rules and the
-- invoice, with no access to their environment.
CREATE TABLE invoice_runs (
  id          TEXT PRIMARY KEY,
  invoice_id  TEXT NOT NULL,
  rule_set_id TEXT NOT NULL REFERENCES rule_sets(id),
  -- The decision, in one word, for the list view.
  outcome     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_invoice_runs_invoice_id ON invoice_runs(invoice_id);

CREATE TABLE invoice_run_steps (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_run_id  TEXT NOT NULL REFERENCES invoice_runs(id),
  seq             INTEGER NOT NULL,
  rule_id         TEXT NOT NULL,
  rule_version    INTEGER NOT NULL,
  -- Rules that did not fire are as important as those that did when
  -- someone asks why an invoice went the way it did.
  matched         INTEGER NOT NULL CHECK (matched IN (0, 1)),
  actions_json    TEXT,
  before_json     TEXT,
  after_json      TEXT
);

CREATE INDEX idx_invoice_run_steps_run_id ON invoice_run_steps(invoice_run_id);

-- Point-in-time: the schema exists and is empty at the moment this
-- migration finishes.
-- ASSERT: SELECT count(*) FROM rule_sets == 0

-- Standing invariant: every rule belongs to a rule set that exists.
-- Phrased as "no row violates X", not as a count, so the next
-- legitimate insert never forces an edit to this migration.
-- ASSERT ALWAYS: SELECT count(*) FROM rules WHERE rule_set_id NOT IN (SELECT id FROM rule_sets) == 0

-- Standing invariant: every rule_version's rule_id refers to a real rule.
-- ASSERT ALWAYS: SELECT count(*) FROM rule_versions WHERE rule_id NOT IN (SELECT id FROM rules) == 0

-- Standing invariant: every invoice_run_step belongs to a run that exists.
-- ASSERT ALWAYS: SELECT count(*) FROM invoice_run_steps WHERE invoice_run_id NOT IN (SELECT id FROM invoice_runs) == 0

-- Standing invariant: rule_sets.mode is always one of the two the
-- interpreter understands (belt-and-braces on top of the CHECK
-- constraint — the CHECK protects future inserts, this assertion is
-- the same guarantee stated as a fact the runner re-checks on every
-- replay, independent of whether someone later drops the constraint).
-- ASSERT ALWAYS: SELECT count(*) FROM rule_sets WHERE mode NOT IN ('first_match', 'all_matches') == 0
