-- wipe-invoice-runtime-data.sql — revised 9 October 2026 (through decision 0702,
-- vf-app migration 0155). Kept in the repository from this revision on, so a
-- new table that points at invoices is added here in the same change.
--
-- Clears all invoice/workflow RUNTIME data so the system can be
-- started afresh, while leaving reference/config data untouched.
--
--   KEPT:    purchase_orders, purchase_order_lines (PO)
--            goods_receipts, goods_receipt_lines (see section 9: opt-in)
--            suppliers, supplier_loads, supplier_field_changes (Supplier)
--            org_* tables (Org + User), absences (people's own plans)
--            processes, process_stages, process_stage_versions,
--            rule_sets, rules, rule_versions, rule_examples,
--            rule_name_translations, stage_*, intake_channels, sources,
--            routes, route_* config, supplier_mappings and versions,
--            lookup lists, coding lists, cost centres, ledgers,
--            custom_fields, dashboard_cards, field_visibility,
--            supplier_return_reasons, goods_return_reasons,
--            org_matching_config and the other config singletons,
--            agents and their history, licence_cache,
--            supplier_layout_resets (when a supplier's learned layouts
--            were last forgotten, 0702)
--            route_messages and their parts/events (the Route monitor's
--            own history, and the samples mappings were built from)
--   CLEARED: every invoice, its lines, documents, working pages (0690),
--            where its values are on the page (0701), comments, keyed fields,
--            overrides, coding splits and saved PO line pairings;
--            every process instance, stage visit and task, and every
--            task's Timeline events; supplier-return emails; the intake
--            and rule-evaluation audit logs; agents' prepared actions on
--            invoices; deliveries to Destinations; ERP exports (their
--            invoices and rows, then the exports themselves); absence
--            task moves (the absences stay); expense_reports.
--
-- Ordered so every DELETE removes a table's own children before the table
-- itself, satisfying every foreign key in workers/vf-app's schema as of
-- migration 0155 (checked against a replay of every migration). D1
-- enforces foreign keys, so the order matters.
--
-- Run with:
--   npx wrangler d1 execute <your-d1-database-name> --remote --file=wipe-invoice-runtime-data.sql --yes
--
-- Take a backup first — this is irreversible:
--   npx wrangler d1 export <your-d1-database-name> --remote --output=backup-before-invoice-wipe.sql
--
-- This session has no Cloudflare credentials and cannot run this. You run it.

-- 0. Newer tables pointing at tasks, instances and invoices.
DELETE FROM task_action_events;          -- -> tasks (Timeline actions, 0083-0094)
DELETE FROM absence_moves;               -- -> tasks (0641; the absences stay)
DELETE FROM supplier_return_emails;      -- -> tasks, process_instances (0498)
DELETE FROM invoice_line_po_pairings;    -- -> invoice_headers (0532)
DELETE FROM invoice_line_coding_splits;  -- -> invoice_headers (0548)
DELETE FROM agent_actions;               -- -> invoice_headers (0631)
DELETE FROM destination_deliveries;      -- -> invoice_headers (0588)
DELETE FROM destination_requests;        -- -> invoice_headers (0588)

-- ERP exports (0552): their invoices and rows, then the exports. An
-- outbound route message may name its export; that link is cleared, and
-- the message itself kept.
DELETE FROM erp_export_rows;
DELETE FROM erp_export_invoices;
UPDATE route_messages SET erp_export_id = NULL WHERE erp_export_id IS NOT NULL;
DELETE FROM erp_exports;

-- 1. Leaves of the invoice/workflow tree.
DELETE FROM pending_document_pages;
DELETE FROM field_overrides;
DELETE FROM stage_visit_steps;
DELETE FROM invoice_run_steps;

-- 2. Tasks, before the stage_visits they point at.
DELETE FROM tasks;

-- 3. Everything hanging directly off an invoice.
DELETE FROM document_comments;
DELETE FROM keyed_fields;
DELETE FROM invoice_collaborators;
DELETE FROM invoice_documents;
DELETE FROM invoice_lines;
DELETE FROM invoice_field_regions;       -- -> invoice_headers (0701)

-- 4. Intake-side records, before the invoices/instances they point at.
DELETE FROM pending_documents;
DELETE FROM intake_capture_events;
DELETE FROM inbound_email_events;

-- 5. The rule-evaluation audit log (invoice_run_steps already gone).
DELETE FROM invoice_runs;

-- 6. Workflow engine state, innermost first.
DELETE FROM stage_visits;
DELETE FROM process_instances;

-- 7. The invoices themselves.
DELETE FROM invoice_pages;
DELETE FROM invoice_headers;

-- 8. Expense reports — a separate document type, not used yet.
DELETE FROM expense_reports;

-- 9. OPT-IN: goods receipts and returns (decision 0644). Kept by default,
--    since they are not invoice data. To test three-way matching from
--    nothing received, remove the "-- " from the next two lines.
-- DELETE FROM goods_receipt_lines;
-- DELETE FROM goods_receipts;
