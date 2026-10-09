-- 0157_combined_line_tasks.sql — decision 0709.
--
-- A stage evaluated once per line raised one task per line that needed
-- attention. "Tasks for lines" lets it instead raise one task for all the
-- lines going to the same team, person and permission:
--   per_line  — one task per line (the behaviour until now)
--   combined  — lines handled by the same people share one task
--
-- A combined task covering several lines keeps line_number NULL and lists
-- its lines, and the rule that sent each one there, in lines_json:
--   [{"line": 1, "rule": "r-po-match"}, {"line": 4, "rule": "r-po-match"}]
-- A combined task that covers only one line is stored exactly as a
-- per-line task is.

ALTER TABLE process_stages ADD COLUMN line_tasks TEXT NOT NULL DEFAULT 'per_line'
  CHECK (line_tasks IN ('per_line', 'combined'));

ALTER TABLE tasks ADD COLUMN lines_json TEXT;

-- Matching, account coding and approval default to combined: one operator
-- usually works the whole invoice in one visit, and an approver sees their
-- lines together. Only stages that evaluate per line are touched.
UPDATE process_stages SET line_tasks = 'combined'
WHERE evaluation_scope = 'line'
  AND (required_permission IN ('AP.Match', 'AP.Code', 'AP.Approve')
       OR uses_approval_hierarchy = 1
       OR id IN ('matching', 'coding', 'account_coding', 'approval'));

-- ASSERT: SELECT count(*) FROM tasks WHERE lines_json IS NOT NULL == 0
-- ASSERT: SELECT count(*) FROM process_stages WHERE line_tasks = 'combined' AND evaluation_scope != 'line' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM process_stages WHERE line_tasks NOT IN ('per_line', 'combined') == 0
