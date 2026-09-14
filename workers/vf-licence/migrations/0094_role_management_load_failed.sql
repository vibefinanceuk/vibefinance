-- 0094_role_management_load_failed.sql
-- Decision 0322 — the Roles screen's own load-failure message. Before
-- this, a failed request left the screen looking like the menu item
-- had done nothing at all.
INSERT INTO ui_strings (key, locale, value) VALUES
  ('roles.loadfailed', 'en', 'We could not load this screen. Try again in a moment.'),
  ('roles.loadfailed', 'de', 'Dieser Bildschirm konnte nicht geladen werden. Bitte versuchen Sie es in Kürze erneut.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'roles.loadfailed' == 2
