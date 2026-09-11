-- 0070_due_today.sql
-- Decision 0248 — "due today", not "due in 0d".
--
-- **Zero days is a number nobody says out loud**, and on the card that
-- decides what to pay it is the most urgent row there is. It should not
-- read like an arithmetic result.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('dash.duetoday', 'en', 'due today'),
 ('dash.duetoday', 'de', 'heute fällig');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'dash.duetoday' == 2
