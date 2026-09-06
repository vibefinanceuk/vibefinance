-- 0025_new_source_strings.sql
-- Decision 0128 — the words the create form needs.
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.new', 'en', 'Add a source');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.create', 'en', 'Create');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.needname', 'en', 'Give the source a name.');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.nameexample', 'en', 'AP Mailbox');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.noprocess', 'en', 'A source belongs to a process, and none exists yet.');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.nostages', 'en', 'no stages');
-- The mechanisms, in words rather than in the column's own spelling.
INSERT INTO ui_strings (key, locale, value) VALUES ('mechanism.email', 'en', 'Email');
INSERT INTO ui_strings (key, locale, value) VALUES ('mechanism.https', 'en', 'HTTPS');
INSERT INTO ui_strings (key, locale, value) VALUES ('mechanism.sftp', 'en', 'SFTP');
INSERT INTO ui_strings (key, locale, value) VALUES ('mechanism.file_import', 'en', 'File import');
INSERT INTO ui_strings (key, locale, value) VALUES ('mechanism.edi', 'en', 'EDI');

INSERT INTO ui_strings (key, locale, value) VALUES ('sources.new', 'de', 'Quelle hinzufügen');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.create', 'de', 'Erstellen');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.needname', 'de', 'Geben Sie der Quelle einen Namen.');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.nameexample', 'de', 'Kreditoren-Postfach');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.noprocess', 'de', 'Eine Quelle gehört zu einem Prozess, und es existiert noch keiner.');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.nostages', 'de', 'keine Stufen');
INSERT INTO ui_strings (key, locale, value) VALUES ('mechanism.email', 'de', 'E-Mail');
INSERT INTO ui_strings (key, locale, value) VALUES ('mechanism.https', 'de', 'HTTPS');
INSERT INTO ui_strings (key, locale, value) VALUES ('mechanism.sftp', 'de', 'SFTP');
INSERT INTO ui_strings (key, locale, value) VALUES ('mechanism.file_import', 'de', 'Dateiimport');
INSERT INTO ui_strings (key, locale, value) VALUES ('mechanism.edi', 'de', 'EDI');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'mechanism.%' == 10
