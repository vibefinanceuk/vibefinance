-- 0035_rules_screen_strings.sql
-- Decision 0149 — the words the rules screen needs.
--
-- **Every one of them, in both seeded languages.** Decision 0107 made
-- the interface translatable and the test derives its expectations from
-- the code rather than a hand-kept list, so a key added here without a
-- German value fails rather than reaching a screen as `rules.title`.
INSERT INTO ui_strings (key, locale, value) VALUES ('nav.rules', 'en', 'Rules');
INSERT INTO ui_strings (key, locale, value) VALUES ('rules.subtitle', 'en', 'What should happen to an invoice, in your words');
INSERT INTO ui_strings (key, locale, value) VALUES ('rules.atstage', 'en', 'Rules at this stage');
INSERT INTO ui_strings (key, locale, value) VALUES ('rules.order', 'en', 'These run in order when an invoice reaches this stage.');
INSERT INTO ui_strings (key, locale, value) VALUES ('rules.empty', 'en', 'No rules run here yet.');
INSERT INTO ui_strings (key, locale, value) VALUES ('rules.norules', 'en', 'no rules');
INSERT INTO ui_strings (key, locale, value) VALUES ('rules.failed', 'en', 'Could not load rules.');
INSERT INTO ui_strings (key, locale, value) VALUES ('rules.new', 'en', 'Write a new rule');
-- The state of a rule, in a word a person uses rather than a column
-- name. 'Paused' and 'Draft' are different because one was trusted once
-- and the other never has been.
INSERT INTO ui_strings (key, locale, value) VALUES ('rulestate.live', 'en', 'Live');
INSERT INTO ui_strings (key, locale, value) VALUES ('rulestate.paused', 'en', 'Paused');
INSERT INTO ui_strings (key, locale, value) VALUES ('rulestate.awaiting_confirmation', 'en', 'To confirm');
INSERT INTO ui_strings (key, locale, value) VALUES ('rulestate.draft', 'en', 'Draft');

INSERT INTO ui_strings (key, locale, value) VALUES ('nav.rules', 'de', 'Regeln');
INSERT INTO ui_strings (key, locale, value) VALUES ('rules.subtitle', 'de', 'Was mit einer Rechnung geschehen soll, in Ihren Worten');
INSERT INTO ui_strings (key, locale, value) VALUES ('rules.atstage', 'de', 'Regeln in dieser Stufe');
INSERT INTO ui_strings (key, locale, value) VALUES ('rules.order', 'de', 'Diese laufen der Reihe nach, sobald eine Rechnung diese Stufe erreicht.');
INSERT INTO ui_strings (key, locale, value) VALUES ('rules.empty', 'de', 'Hier laufen noch keine Regeln.');
INSERT INTO ui_strings (key, locale, value) VALUES ('rules.norules', 'de', 'keine Regeln');
INSERT INTO ui_strings (key, locale, value) VALUES ('rules.failed', 'de', 'Regeln konnten nicht geladen werden.');
INSERT INTO ui_strings (key, locale, value) VALUES ('rules.new', 'de', 'Neue Regel schreiben');
INSERT INTO ui_strings (key, locale, value) VALUES ('rulestate.live', 'de', 'Aktiv');
INSERT INTO ui_strings (key, locale, value) VALUES ('rulestate.paused', 'de', 'Pausiert');
INSERT INTO ui_strings (key, locale, value) VALUES ('rulestate.awaiting_confirmation', 'de', 'Zu bestätigen');
INSERT INTO ui_strings (key, locale, value) VALUES ('rulestate.draft', 'de', 'Entwurf');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'rules.%' OR key LIKE 'rulestate.%' OR key = 'nav.rules' == 24
