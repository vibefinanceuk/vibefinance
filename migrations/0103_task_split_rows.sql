-- 0103_task_split_rows.sql
-- Decision 0551 — which rows of a split line (0548) a task is for.
-- A comma-separated list of row numbers ("1,3"); NULL for a task about
-- a whole line, a whole invoice, or a line that is not split. The
-- viewer shows the person their rows and what they come to.
ALTER TABLE tasks ADD COLUMN split_rows TEXT;

-- ASSERT: SELECT count(*) FROM tasks WHERE split_rows IS NOT NULL == 0
