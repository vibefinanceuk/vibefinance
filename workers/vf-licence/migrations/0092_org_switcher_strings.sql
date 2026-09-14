-- 0092_org_switcher_strings.sql
-- Decision 0313 — the org switcher's own strings. Org names themselves
-- are data (org_units.name), not translated UI text; these are the
-- two words the picker needs around them.
INSERT INTO ui_strings (key, locale, value) VALUES
  ('org.all', 'en', 'All organisations'),
  ('org.switchheading', 'en', 'Switch organisation'),
  ('org.all', 'de', 'Alle Organisationen'),
  ('org.switchheading', 'de', 'Organisation wechseln');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('org.all', 'org.switchheading') == 4
