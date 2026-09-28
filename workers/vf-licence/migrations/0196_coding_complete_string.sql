-- 0196_coding_complete_string.sql
-- Decision 0541. The Coding button's hover text once a line is coded.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.coding.complete', 'en', 'coded'),
 ('viewer.coding.complete', 'de', 'kontiert');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'viewer.coding.complete' == 2
