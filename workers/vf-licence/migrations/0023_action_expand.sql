-- 0023_action_expand.sql
-- Decision 0122 — "Open in new window" becomes "Expand".
--
-- **The old wording described the mechanism**, not the intent. Somebody
-- wants the document bigger; that it arrives in another window is how,
-- not why — and it is only in another window because a Worker cannot
-- render a PDF (decision 0042), which is our constraint rather than
-- theirs.
UPDATE ui_strings SET value = 'Expand' WHERE key = 'viewer.open' AND locale = 'en';
UPDATE ui_strings SET value = 'Vergrößern' WHERE key = 'viewer.open' AND locale = 'de';

-- The row of actions needs a label each — decision 0122. `action.claim`
-- and the rest already exist for the task list, which is the point of
-- keying words rather than writing them twice.
INSERT INTO ui_strings (key, locale, value) VALUES ('action.expand', 'en', 'Expand');
INSERT INTO ui_strings (key, locale, value) VALUES ('action.save', 'en', 'Save');
INSERT INTO ui_strings (key, locale, value) VALUES ('action.expand', 'de', 'Vergrößern');
INSERT INTO ui_strings (key, locale, value) VALUES ('action.save', 'de', 'Speichern');

-- Point-in-time: both new labels exist in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('action.expand','action.save') == 4
