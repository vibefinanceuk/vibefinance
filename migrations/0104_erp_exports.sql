-- 0104_erp_exports.sql
-- Decision 0552 — the ERP export: a CSV file of payment-eligible
-- invoices, one row per distribution (a line, or each row of a split
-- line, 0548), each invoice exported once.
--
-- `erp_export_invoices` holds one row per invoice ever exported, so its
-- primary key is what makes "each once" true, even for two exports made
-- at the same moment. `erp_export_rows` keeps each export's rows as they
-- were taken, so downloading an export again gives the same file after
-- an invoice is corrected, and a later API push or ERP-specific layout
-- (planned) can read the same rows.
CREATE TABLE erp_exports (
  id            TEXT PRIMARY KEY,
  created_by    TEXT NOT NULL REFERENCES org_users(id),
  created_at    TEXT NOT NULL,
  invoice_count INTEGER NOT NULL,
  row_count     INTEGER NOT NULL
);

CREATE TABLE erp_export_invoices (
  invoice_id TEXT PRIMARY KEY REFERENCES invoice_headers(id),
  export_id  TEXT NOT NULL REFERENCES erp_exports(id)
);
CREATE INDEX idx_erp_export_invoices_export ON erp_export_invoices(export_id);

CREATE TABLE erp_export_rows (
  export_id  TEXT NOT NULL REFERENCES erp_exports(id),
  seq        INTEGER NOT NULL,
  invoice_id TEXT NOT NULL REFERENCES invoice_headers(id),
  row_json   TEXT NOT NULL,
  PRIMARY KEY (export_id, seq)
);

-- ASSERT: SELECT count(*) FROM erp_exports == 0
-- The permission vocabulary as it now stands, with AP.Export (decision
-- 0552), restated rather than editing an applied migration (0048's
-- standing invariant, last restated by 0078).
-- ASSERT ALWAYS: SELECT count(*) FROM process_stages WHERE required_permission IS NOT NULL AND required_permission NOT IN ('AP.Analysis','AP.Approve','AP.Assistant','AP.Code','AP.Dashboard','AP.Discard','AP.Export','AP.FraudReview','AP.Manager','AP.Match','AP.Return','AP.ReturnAny','AP.ReturnToSupplier','AP.Review','AP.Supplier','AP.TaskManage','AP.TaskView','AP.Validate','AR.Analysis','AR.Approve','AR.Collect','AR.Issue','AR.Remind','AR.Validate','Admin.ConfigManagement','Admin.Configure','Admin.RoleManagement','Admin.RuleActivation','Admin.RuleManagement','Admin.UserManagement','Expense.Approve','Expense.Review','Expense.Submit','Procurement.Approve','Procurement.Collaborate','Supplier.Maintain','System.LicenceRefresh','System.UsagePush') == 0
-- ASSERT ALWAYS: SELECT count(*) FROM erp_export_invoices WHERE export_id NOT IN (SELECT id FROM erp_exports) == 0
