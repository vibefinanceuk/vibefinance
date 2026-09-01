-- 0012_mandate_channel_and_expense_reports.sql
-- Two changes, both real extensions of the intake-channel work
-- (decisions 0023/0024): see docs/decisions/0025-intake-channel-in-
-- routes-and-expense-storage.md.

-- 1. Promote mandate.channel to a real, queryable column on
-- invoice_headers — the same "structured column for what's actually
-- searched on, opaque JSON for the rest" discipline that already
-- promoted supplier_vat_id, currency, issue_date, and total_with_vat
-- (decision 0017). Previously only reachable buried inside the
-- opaque facts_json blob.
ALTER TABLE invoice_headers ADD COLUMN mandate_channel TEXT;

-- 2. Expense facts storage — the exact gap decision 0017 closed for
-- invoices (AP/AR), never closed for Expense at all. Every prior
-- expense test (decision 0022) proved the vocabulary and workflow
-- engine work using facts supplied inline; nothing about expense data
-- has ever actually been persisted anywhere until this. A single
-- flat table, not a header/lines split like invoices — expense
-- reports, as modeled by decision 0022's own EXPENSE_FIELDS, were
-- never a header-with-multiple-lines document the way an EN 16931
-- invoice genuinely is; each submission is its own flat record.
CREATE TABLE expense_reports (
  id               TEXT PRIMARY KEY,
  employee_id      TEXT,
  category         TEXT,
  amount           REAL,
  currency         TEXT,
  submitted_date   TEXT,
  cost_centre      TEXT,
  -- Boolean as 0/1 — the same convention stage_visit_steps.matched
  -- already established, not a new one invented here.
  receipt_attached INTEGER,
  trip_end_date    TEXT,
  intake_channel   TEXT,
  facts_json       TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  -- Mutable, same reasoning invoice_headers already gives for its own
  -- updated_at: an expense report may be corrected, or enriched, over
  -- its lifecycle, the same as an invoice.
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_expense_reports_employee ON expense_reports(employee_id);

-- Point-in-time: expense_reports is empty at the moment this migration finishes.
-- ASSERT: SELECT count(*) FROM expense_reports == 0
