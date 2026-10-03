-- 0256_open_tasks_picker_strings.sql
-- Decision 0612. Open tasks by user: a person picker.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('workload.opentasksuser', 'en', 'User'),
 ('workload.opentasksuser', 'de', 'Benutzer');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('workload.opentasksuser') == 2
