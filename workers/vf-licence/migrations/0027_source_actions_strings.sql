-- 0027_source_actions_strings.sql
-- Decision 0130 — the words for retiring and renaming.
--
-- **"Retire", not "Delete"**, because that is what usually happens: a
-- document that arrived through a source carries its name, and rules
-- reference that name. Promising deletion and archiving instead is the
-- mistake decision 0078 records.
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.retire', 'en', 'Retire');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.rename', 'en', 'Rename');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.retired', 'en', 'Retired');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.retire', 'de', 'Stilllegen');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.rename', 'de', 'Umbenennen');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.retired', 'de', 'Stillgelegt');

-- Point-in-time: all three exist in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('sources.retire','sources.rename','sources.retired') == 6
