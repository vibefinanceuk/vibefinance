-- 0099_coding_entry_status_and_budget.sql
-- Decision 0542 — a Project has a lifecycle and a budget.
--
-- `status`: 'active' or 'closed'. A closed entry is no longer offered
-- in the Coding pop-out, a save coding a line to it is refused, and a
-- line still carrying it is flagged (coding.line_invalid, 0511). Kept on
-- every Account Coding list, not only Project, since "no longer in use"
-- means the same for any of them; AP Setup sets it on Projects for now.
--
-- `budget_amount`: a Project's budget, or NULL for none. What its lines
-- have used is computed, never stored (as PO consumption is, 0533).
ALTER TABLE coding_list_entries ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed'));
ALTER TABLE coding_list_entries ADD COLUMN budget_amount REAL CHECK (budget_amount IS NULL OR budget_amount >= 0);

-- ASSERT: SELECT count(*) FROM coding_list_entries WHERE status != 'active' OR budget_amount IS NOT NULL == 0
-- ASSERT ALWAYS: SELECT count(*) FROM coding_list_entries WHERE status NOT IN ('active', 'closed') == 0
-- ASSERT ALWAYS: SELECT count(*) FROM coding_list_entries WHERE budget_amount IS NOT NULL AND list_type_id != 'project' == 0
