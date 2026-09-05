-- 0016_interface_frame_strings.sql
-- Decision 0108 — the words the frame and the reworked viewer need.
--
-- Added as their own migration rather than edited into 0014, so a
-- wording change is a reviewable diff rather than an edit to something
-- already applied.
INSERT INTO ui_strings (key, locale, value) VALUES ('nav.tasks', 'en', 'Tasks');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.status', 'en', 'Status');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.known', 'en', 'fields known');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.fields', 'en', 'Invoice header');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.actions', 'en', 'Actions');
INSERT INTO ui_strings (key, locale, value) VALUES ('nav.tasks', 'de', 'Aufgaben');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.status', 'de', 'Status');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.known', 'de', 'Felder bekannt');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.fields', 'de', 'Rechnungskopf');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.actions', 'de', 'Aktionen');

-- Point-in-time: five new keys, in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('nav.tasks','viewer.status','viewer.known','viewer.fields','viewer.actions') == 10
