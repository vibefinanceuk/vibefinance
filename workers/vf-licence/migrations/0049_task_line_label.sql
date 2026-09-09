-- 0049_task_line_label.sql
-- Decision 0183 — which line a task is about.
--
-- A stage scoped `per_line` raises one task per invoice line, and the
-- list showed them as identical rows.
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.line', 'en', 'line');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.line', 'de', 'Position');

-- Point-in-time: it exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'tasks.line' == 2
