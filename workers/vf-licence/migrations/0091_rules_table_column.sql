-- 0091_rules_table_column.sql
-- Decision 0310 — the Rules list rebuilt as a real table, matching
-- Documents and Tasks. `column.status` already exists in the shared
-- column-header namespace (decision from the Documents screen); this
-- adds the one header that namespace doesn't already have.
INSERT INTO ui_strings (key, locale, value) VALUES
  ('column.rule', 'en', 'Rule'),
  ('column.rule', 'de', 'Regel');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'column.rule' == 2
