-- 0345_combined_reasons_strings.sql
-- Decision 0746 — a task for the whole invoice raised by several rules says how many.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('tasks.reasons', 'en', '{n} reasons'),
 ('tasks.reasons', 'de', '{n} Gründe');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'tasks.reasons' == 2
