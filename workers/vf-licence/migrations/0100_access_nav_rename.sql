-- 0100_access_nav_rename.sql
-- Decision 0333 — reported live: "Roles does not seem suitable" once
-- the screen grew to cover org units, people, and teams alongside
-- role definitions. nav.roles is left in place, unused rather than
-- deleted — an orphaned string is harmless; deleting rows in a
-- migration is not the established pattern this project follows.
INSERT INTO ui_strings (key, locale, value) VALUES
  ('nav.access', 'en', 'Access'),
  ('nav.access', 'de', 'Zugriff');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'nav.access' AND locale = 'en' == 1
