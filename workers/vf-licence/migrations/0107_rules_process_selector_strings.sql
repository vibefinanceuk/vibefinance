-- 0107_rules_process_selector_strings.sql
-- Decision 0351 — the Rules screen's own process selector, reported
-- live: a second, real process's own stage looked like a step in the
-- first process's own sequence, since the stage list had never been
-- scoped to one process at all.
INSERT INTO ui_strings (key, locale, value) VALUES
  ('rules.process', 'en', 'Process'),
  ('rules.process', 'de', 'Prozess');

-- ASSERT ALWAYS: SELECT count(*) FROM ui_strings WHERE key = 'rules.process' AND locale = 'en' == 1
