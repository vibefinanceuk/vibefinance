INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.workflow.stageerror', 'en', 'This invoice stopped moving because of a processing error:'),
 ('viewer.workflow.stageerror', 'de', 'Diese Rechnung wird wegen eines Verarbeitungsfehlers nicht weiter bearbeitet:');
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'viewer.workflow.stageerror' == 2
