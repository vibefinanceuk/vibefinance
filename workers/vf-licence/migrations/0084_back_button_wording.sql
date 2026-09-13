-- 0084_back_button_wording.sql
-- Decision 0284 — reported live: "Please can this be updated to read
-- simply 'Back'." Shortened once the button carries its own icon and
-- sits beside Sign out, another two-word label with its own icon --
-- "Back to tasks" was the only three-word entry in a row that reads
-- as a list of quick actions.
UPDATE ui_strings SET value = 'Back' WHERE key = 'viewer.back' AND locale = 'en';
UPDATE ui_strings SET value = 'Zurück' WHERE key = 'viewer.back' AND locale = 'de';

-- Point-in-time: the wording changed and nothing was lost.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'viewer.back' == 2
