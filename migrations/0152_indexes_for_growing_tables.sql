-- 0152_indexes_for_growing_tables.sql — decision 0692.
--
-- Indexes for the tables that grow with every invoice, found by running
-- EXPLAIN QUERY PLAN over every query in vf-app's source against the full
-- schema (decision 0692 has the method and the before/after plans).
--
-- `tasks` had no index but its primary key: every inbox, count and
-- "is anything still open on this visit" read the whole table.
--
-- Indexes only: no data changes, safe to apply at any time. Each write to
-- these tables maintains them, a small cost against reads that otherwise
-- grow with every invoice ever processed.

-- Tasks: the inbox (open, mine or my team's), the open-on-this-visit
-- checks after every action, per-stage counts, and Throughput by user.
CREATE INDEX IF NOT EXISTS idx_tasks_status_team    ON tasks(status, owner_team_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status_owner   ON tasks(status, owner_user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status_claimed ON tasks(status, claimed_by);
CREATE INDEX IF NOT EXISTS idx_tasks_visit_status   ON tasks(stage_visit_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_stage_status   ON tasks(stage_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_completed_by   ON tasks(completed_by, completed_at);

-- Workflow: visits per stage, instances per process.
CREATE INDEX IF NOT EXISTS idx_stage_visits_stage            ON stage_visits(stage_id);
CREATE INDEX IF NOT EXISTS idx_process_instances_process     ON process_instances(process_id, status);
CREATE INDEX IF NOT EXISTS idx_intake_capture_events_instance ON intake_capture_events(process_instance_id);

-- Invoices: the Documents list, newest first, when no org narrows it.
CREATE INDEX IF NOT EXISTS idx_invoice_headers_created ON invoice_headers(created_at);

-- Documents and pages: the Attachments tab and the viewer's retained pages.
CREATE INDEX IF NOT EXISTS idx_invoice_documents_message ON invoice_documents(route_message_id);
CREATE INDEX IF NOT EXISTS idx_pending_documents_invoice ON pending_documents(invoice_id);

-- Messages: the Route monitor's counts for today, deliveries by message,
-- arrivals by source.
CREATE INDEX IF NOT EXISTS idx_route_messages_received        ON route_messages(received_at);
CREATE INDEX IF NOT EXISTS idx_destination_deliveries_message ON destination_deliveries(message_id);
CREATE INDEX IF NOT EXISTS idx_inbound_email_events_source    ON inbound_email_events(source_id, occurred_at);

-- History and usage: an invoice's ERP exports, the month's rule runs
-- (usage reporting), a rule version's worked examples, old agent runs.
CREATE INDEX IF NOT EXISTS idx_erp_export_rows_invoice ON erp_export_rows(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_runs_created    ON invoice_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_rule_examples_version   ON rule_examples(rule_id, rule_version);
CREATE INDEX IF NOT EXISTS idx_agent_runs_started      ON agent_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_agent_actions_run       ON agent_actions(run_id);
