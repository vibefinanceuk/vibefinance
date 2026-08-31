-- 0007_invoice_facts.sql
-- Persisted invoice header and line facts (see docs/decisions/
-- 0015-process-workflow-engine.md's "three distinct gaps" table, and
-- docs/decisions/0017-invoice-facts-storage.md). Nothing in this
-- system has previously persisted invoice FACTS at all — only
-- evaluation OUTCOMES (invoice_runs) — so "find other invoices from
-- this supplier, same amount, within 30 days" has never been
-- answerable, and neither has "evaluate this line against its own
-- cost centre's threshold."
--
-- Deliberately queryable columns for what's actually searched on
-- (mirroring rule_versions' own version column being promoted out of
-- its otherwise-opaque compiled_json blob), everything else in
-- facts_json — the same "structured column for what's indexed,
-- opaque JSON for the rest" split already used throughout this
-- project.

CREATE TABLE invoice_headers (
  id              TEXT PRIMARY KEY,
  -- Deliberately NOT a foreign key to any one rule_set — which rule
  -- set governs a given evaluation is a per-request decision
  -- (POST /rules/evaluate's own ruleSetId parameter), not a fixed
  -- property of the invoice itself. A single invoice may reasonably
  -- be evaluated against different rule sets at different workflow
  -- stages once the workflow engine (decision 0015) exists.
  supplier_vat_id TEXT,
  currency        TEXT,
  issue_date      TEXT,
  total_with_vat  REAL,
  -- Every other fact about this invoice — deliberately opaque here,
  -- the same discipline rule_versions.compiled_json already follows.
  facts_json      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  -- Facts are mutable, not versioned-and-immutable like rule_versions
  -- — a deliberate, different choice, not an oversight. Decision
  -- 0015's fact-producing agents are explicitly meant to enrich an
  -- invoice's facts over its lifecycle (duplicate-match scores, and
  -- so on); evaluating "by invoiceId" reads current state, not a
  -- frozen historical snapshot. Anyone needing a specific, frozen
  -- point-in-time reproduction still has the inline `facts` path on
  -- POST /rules/evaluate, unchanged — the same reproducibility
  -- escape hatch decision 0007 already established for rules.
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_invoice_headers_supplier ON invoice_headers(supplier_vat_id);

CREATE TABLE invoice_lines (
  id           TEXT PRIMARY KEY,
  invoice_id   TEXT NOT NULL REFERENCES invoice_headers(id),
  line_number  INTEGER NOT NULL,
  description  TEXT,
  amount       REAL,
  -- A plain string, deliberately not yet a foreign key to org_units.
  -- Whether a cost centre IS an org_unit or a genuinely separate
  -- concept is an explicitly open question in decision 0015 — stored
  -- now so the column exists and the mapping can be resolved and
  -- enforced later without a schema rework, the same "add now,
  -- clearly flagged" precedent as org_users.locale.
  cost_centre  TEXT,
  facts_json   TEXT NOT NULL,
  UNIQUE (invoice_id, line_number)
);

CREATE INDEX idx_invoice_lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX idx_invoice_lines_cost_centre ON invoice_lines(cost_centre);

-- Point-in-time: both tables are empty at the moment this migration finishes.
-- ASSERT: SELECT count(*) FROM invoice_headers == 0
-- ASSERT: SELECT count(*) FROM invoice_lines == 0

-- Standing invariant: every line references a real header — the FK
-- above already enforces this at the SQL layer; restated here as an
-- explicit assertion so the replay tool reports it directly.
-- ASSERT ALWAYS: SELECT count(*) FROM invoice_lines WHERE invoice_id NOT IN (SELECT id FROM invoice_headers) == 0

-- Standing invariant: line numbers within one invoice are never
-- duplicated — the UNIQUE constraint above already enforces this;
-- restated for the same reason.
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT invoice_id, line_number FROM invoice_lines GROUP BY invoice_id, line_number HAVING count(*) > 1) == 0
