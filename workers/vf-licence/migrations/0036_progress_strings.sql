-- 0036_progress_strings.sql
-- Decision 0151 — the words for an invoice's path through the process.
INSERT INTO ui_strings (key, locale, value) VALUES ('progress.since', 'en', 'here since {when}');
INSERT INTO ui_strings (key, locale, value) VALUES ('progress.revisited', 'en', 'This invoice came back to this stage.');

INSERT INTO ui_strings (key, locale, value) VALUES ('progress.since', 'de', 'hier seit {when}');
INSERT INTO ui_strings (key, locale, value) VALUES ('progress.revisited', 'de', 'Diese Rechnung kam zu dieser Stufe zurück.');

-- Point-in-time: both exist in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'progress.%' == 4
