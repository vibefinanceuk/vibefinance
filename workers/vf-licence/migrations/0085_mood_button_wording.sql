-- 0085_mood_button_wording.sql
-- Decision 0286 — the mood control rebuilt as an icon-and-label toggle
-- button, matching Sign out and Back. Requested: "trim the text to
-- read 'Night', or 'Day' to reduce text width." `mood.label` ("Mood")
-- is left as it was — decision 0071's own precedent, a string kept
-- even once nothing in the code reads it, since a customer may
-- already have a translation riding on the key.
UPDATE ui_strings SET value = 'Day' WHERE key = 'mood.day' AND locale = 'en';
UPDATE ui_strings SET value = 'Night' WHERE key = 'mood.night' AND locale = 'en';
UPDATE ui_strings SET value = 'Tag' WHERE key = 'mood.day' AND locale = 'de';
UPDATE ui_strings SET value = 'Nacht' WHERE key = 'mood.night' AND locale = 'de';

-- Point-in-time: the wording changed and nothing was lost.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('mood.day','mood.night') == 4
