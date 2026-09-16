-- 0108_start_draft_strings.sql
-- Decision 0353 — a real entry point into modifying an existing
-- process, reported live: "It seems that I cannot modify an existing
-- process?" Only adding or removing a specific stage had ever started
-- a draft; this is the button for starting one with nothing new in it.
INSERT INTO ui_strings (key, locale, value) VALUES
  ('action.startdraft', 'en', 'Start draft'),
  ('action.startdraft', 'de', 'Entwurf starten');

-- ASSERT ALWAYS: SELECT count(*) FROM ui_strings WHERE key = 'action.startdraft' AND locale = 'en' == 1
