-- 0215_mapping_retire_popout_strings.sql
-- Decision 0564. Retiring a mapping is confirmed in a pop-out, titled
-- Retire mapping, with Retire mapping or Cancel.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('mapping.retiretitle', 'en', 'Retire mapping'),
 ('mapping.retiretitle', 'de', 'Zuordnung stilllegen');

UPDATE ui_strings SET value = 'Retire mapping' WHERE key = 'mapping.retireyes' AND locale = 'en';
UPDATE ui_strings SET value = 'Zuordnung stilllegen' WHERE key = 'mapping.retireyes' AND locale = 'de';
UPDATE ui_strings SET value = 'Cancel' WHERE key = 'mapping.retireno' AND locale = 'en';
UPDATE ui_strings SET value = 'Abbrechen' WHERE key = 'mapping.retireno' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'mapping.retiretitle' == 2
-- ASSERT: SELECT count(*) FROM ui_strings WHERE (key = 'mapping.retireyes' AND value IN ('Retire mapping', 'Zuordnung stilllegen')) OR (key = 'mapping.retireno' AND value IN ('Cancel', 'Abbrechen')) == 4
