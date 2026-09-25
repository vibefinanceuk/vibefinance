-- 0171_note_ok_string.sql
-- Decision 0492 — the viewer's own note() became a pop-out alert
-- requiring an explicit acknowledgement, replacing 0491's
-- scrollIntoView approach before it ever shipped (see note()'s own
-- doc comment in viewer.js). This is its one new string: the label on
-- the alert's single dismiss button.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.ok', 'en', 'OK');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.ok', 'de', 'OK');

-- Point-in-time: the key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'action.ok' == 2
