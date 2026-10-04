-- 0133_agent_documents.sql
-- Decision 0629 — Agents phase 2, slice 2: Open in Documents. Each email
-- copy keeps the invoices behind it, so the link in the email opens
-- Documents at exactly those, for the person it was sent to. (A note on
-- the task list carries its rows' invoices in its own report.)

ALTER TABLE agent_deliveries ADD COLUMN invoice_ids_json TEXT;
