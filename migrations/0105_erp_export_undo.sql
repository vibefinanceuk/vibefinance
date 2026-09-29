-- 0105_erp_export_undo.sql
-- Decision 0553 — undoing an ERP export (0552): for when a file failed to
-- import on the ERP side. The export is kept, marked undone with who,
-- when and why, and its invoices go back to Ready to export (their
-- erp_export_invoices rows are removed), so they can be exported again.
-- Its rows stay, so the file it produced can still be downloaded.
ALTER TABLE erp_exports ADD COLUMN reversed_at TEXT;
ALTER TABLE erp_exports ADD COLUMN reversed_by TEXT REFERENCES org_users(id);
ALTER TABLE erp_exports ADD COLUMN reverse_reason TEXT;

-- ASSERT: SELECT count(*) FROM erp_exports WHERE reversed_at IS NOT NULL == 0
-- Undone means all three: when, by whom, and why.
-- ASSERT ALWAYS: SELECT count(*) FROM erp_exports WHERE (reversed_at IS NULL) != (reversed_by IS NULL) OR (reversed_at IS NULL) != (reverse_reason IS NULL) == 0
-- An undone export holds no invoices.
-- ASSERT ALWAYS: SELECT count(*) FROM erp_export_invoices ei JOIN erp_exports x ON x.id = ei.export_id WHERE x.reversed_at IS NOT NULL == 0
