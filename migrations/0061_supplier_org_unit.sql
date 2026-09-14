-- 0061_supplier_org_unit.sql
--
-- **The hook decision 0208 already left** — decision 0317's own
-- follow-on: "let me pick one org to focus on, seeing only that org's
-- work." Suppliers are a mirror, not a master (decision 0208), and
-- have no org concept at all today: `erp_site_identifier` is the
-- ERP's own site code, a free string never linked to one of this
-- system's own org_units.
--
-- Nullable, the same "unassigned is a real, expected state" every
-- other org-scoped column in this system already uses. Every existing
-- supplier becomes unassigned on the day this lands, not orphaned.
ALTER TABLE suppliers ADD COLUMN org_unit_id TEXT REFERENCES org_units(id);

CREATE INDEX idx_suppliers_org_unit ON suppliers(org_unit_id);

-- ASSERT: SELECT count(*) FROM pragma_table_info('suppliers') WHERE name = 'org_unit_id' == 1
