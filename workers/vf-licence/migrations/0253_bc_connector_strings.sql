-- 0253_bc_connector_strings.sql
-- Decision 0609. Business Central: two mapping functions.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('mapping.fn.present_as', 'en', 'Fixed text where present'),
 ('mapping.fn.present_as', 'de', 'Fester Text, wenn vorhanden'),
 ('mapping.fn.empty_if', 'en', 'Empty if'),
 ('mapping.fn.empty_if', 'de', 'Leer, wenn');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('mapping.fn.present_as','mapping.fn.empty_if') == 4
