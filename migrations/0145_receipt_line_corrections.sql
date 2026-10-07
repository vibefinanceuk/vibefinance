-- 0145_receipt_line_corrections.sql — decision 0657.
--
-- A line at Matching can have its unit and quantity corrected (Dan found
-- 2 BOX against an order line in EA could only be rejected). What the
-- warehouse sent is kept the first time a line is corrected, with who
-- corrected it and when; later corrections keep that first original.

ALTER TABLE goods_receipt_lines ADD COLUMN original_unit_code TEXT;
ALTER TABLE goods_receipt_lines ADD COLUMN original_quantity REAL;
ALTER TABLE goods_receipt_lines ADD COLUMN corrected_by TEXT REFERENCES org_users(id);
ALTER TABLE goods_receipt_lines ADD COLUMN corrected_at TEXT;

-- ASSERT ALWAYS: SELECT count(*) FROM goods_receipt_lines WHERE corrected_at IS NOT NULL AND original_quantity IS NULL == 0
