-- 0109_new_draft_wording.sql
-- Decision 0354 — from the operator: "rather than 'Start Draft',
-- could you reword to read 'New draft'?" Matches the established
-- "New process" and "New person" naming already used elsewhere on
-- this same screen, rather than a differently-shaped verb of its own.
UPDATE ui_strings SET value = 'New draft' WHERE key = 'action.startdraft' AND locale = 'en';
UPDATE ui_strings SET value = 'Neuer Entwurf' WHERE key = 'action.startdraft' AND locale = 'de';

-- Point-in-time: the wording changed and nothing was lost.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'action.startdraft' == 2
