-- 0047_unclaimed_owner.sql
-- Decision 0176 — a task nobody has claimed.
--
-- **Says so rather than saying nothing.** An absent owner line reads as
-- a screen that forgot; *unclaimed* is a real and useful answer,
-- because it means anybody may take it.
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.unclaimed', 'en', 'Nobody yet');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.unclaimed', 'de', 'Noch niemand');

-- Point-in-time: it exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'tasks.unclaimed' == 2
