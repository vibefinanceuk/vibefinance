-- 0105_sources_action_icons_strings.sql
-- Decision 0347 — icons for Rename, Retire, and Create on the
-- Sources screen.
INSERT INTO ui_strings (key, locale, value) VALUES
  ('action.rename', 'en', 'Rename'),
  ('action.retire', 'en', 'Retire'),
  ('action.rename', 'de', 'Umbenennen'),
  ('action.retire', 'de', 'Stilllegen');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('action.rename','action.retire') AND locale = 'en' == 2
