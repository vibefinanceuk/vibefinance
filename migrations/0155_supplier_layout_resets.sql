-- 0155_supplier_layout_resets.sql — decision 0702.
--
-- A supplier's invoice layouts are learned from where its invoices' values
-- were (invoice_field_regions, 0701), worked out when asked rather than
-- stored. "Forget what was learned" (docs/design/supplier-layout-learning.md,
-- §5, decision 3) is therefore a point in time: regions recorded before it no
-- longer count for that supplier. Nothing is deleted.

CREATE TABLE supplier_layout_resets (
  supplier_id  TEXT PRIMARY KEY REFERENCES suppliers(id),
  reset_at     TEXT NOT NULL,
  reset_by     TEXT REFERENCES org_users(id)
);

-- Learning reads a supplier's invoices' regions: by supplier, then invoice.
CREATE INDEX IF NOT EXISTS idx_invoice_field_regions_invoice ON invoice_field_regions(invoice_id, recorded_at);

-- ASSERT: SELECT count(*) FROM supplier_layout_resets == 0
