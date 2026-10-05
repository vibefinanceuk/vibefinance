-- 0137_agent_queries.sql
-- Decision 0638 — Agents ask the data, slice 5: the daily allowance of
-- agents' own questions, and indexes for the questions' common paths.

-- Each run or try of a question takes one of the day's (UTC), against the
-- licence's `queryLimit` (default 500; 0 leaves questions out).
CREATE TABLE agent_query_days (
  day     TEXT PRIMARY KEY,
  queries INTEGER NOT NULL DEFAULT 0 CHECK (queries >= 0)
);

-- Days at a stage, and when an invoice moved on (stage_visits datasets).
CREATE INDEX idx_stage_visits_instance_time ON stage_visits(process_instance_id, created_at);
-- At the ERP, and deliveries by invoice.
CREATE INDEX idx_destination_deliveries_invoice ON destination_deliveries(invoice_id, status);
-- Whether a purchase order line is invoiced.
CREATE INDEX idx_po_pairings_order_line ON invoice_line_po_pairings(order_number, po_line_number);
-- Returns, by when they were returned.
CREATE INDEX idx_process_instances_status_ended ON process_instances(status, ended_at);
-- New since the last run, per organisation.
CREATE INDEX idx_invoice_headers_org_created ON invoice_headers(org_unit_id, created_at);

-- ASSERT: SELECT count(*) FROM agent_query_days == 0
