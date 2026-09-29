-- 0101_supplier_project_only.sql
-- Decision 0547 — a supplier site whose spend is project-only
-- expenditure. Its invoices' coded lines need a project before a coding
-- task completes, and under "one or the other" (0540) they are coded to
-- a project, never a cost centre.
--
-- **VibeFinance's own setting, not the ERP's.** The supplier load
-- (0208) names every column it writes, so a reload leaves this alone.
-- Off for every existing site.
ALTER TABLE suppliers ADD COLUMN project_only INTEGER NOT NULL DEFAULT 0 CHECK (project_only IN (0, 1));

-- ASSERT: SELECT count(*) FROM suppliers WHERE project_only != 0 == 0
