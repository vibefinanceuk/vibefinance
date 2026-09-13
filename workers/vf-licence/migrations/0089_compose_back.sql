-- 0089_compose_back.sql
-- Decision 0305 — a Back button, top right of "Write a rule", to the
-- Rules list. Its own key rather than reusing viewer.back, so this
-- screen's own wording can move independently of the viewer's.
INSERT INTO ui_strings (key, locale, value) VALUES
  ('compose.back', 'en', 'Back'),
  ('compose.back', 'de', 'Zurück');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'compose.back' == 2
