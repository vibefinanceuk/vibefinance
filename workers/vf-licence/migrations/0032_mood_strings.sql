-- 0032_mood_strings.sql
-- Decision 0139 — the words for the mood control.
--
-- "Mood" rather than "Theme" or "Appearance", asked for by name — and
-- it reads better than either: somebody choosing between working in
-- daylight and working at night is describing their circumstances, not
-- configuring a product.
INSERT INTO ui_strings (key, locale, value) VALUES ('mood.label', 'en', 'Mood');
INSERT INTO ui_strings (key, locale, value) VALUES ('mood.day', 'en', 'Day time');
INSERT INTO ui_strings (key, locale, value) VALUES ('mood.night', 'en', 'Night time');

INSERT INTO ui_strings (key, locale, value) VALUES ('mood.label', 'de', 'Stimmung');
INSERT INTO ui_strings (key, locale, value) VALUES ('mood.day', 'de', 'Tagsüber');
INSERT INTO ui_strings (key, locale, value) VALUES ('mood.night', 'de', 'Nachts');

-- Point-in-time: all three exist in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'mood.%' == 6
