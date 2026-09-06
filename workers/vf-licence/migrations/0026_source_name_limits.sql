-- 0026_source_name_limits.sql
-- Decision 0129 — what the platform will accept.
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.needletters', 'en', 'The name needs at least one letter or number.');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.toolong', 'en', 'That name is too long for an email address. Try something shorter.');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.needletters', 'de', 'Der Name braucht mindestens einen Buchstaben oder eine Ziffer.');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.toolong', 'de', 'Dieser Name ist für eine E-Mail-Adresse zu lang. Bitte kürzer wählen.');

-- Point-in-time: both exist in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('sources.needletters','sources.toolong') == 4
