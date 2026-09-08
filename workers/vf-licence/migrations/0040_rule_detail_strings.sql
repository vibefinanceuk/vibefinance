-- 0040_rule_detail_strings.sql
-- Decision 0155 — opening a rule.
--
-- **"Pause", not "deactivate".** The list already says *Paused*, and an
-- interface with two names for one act is an interface somebody has to
-- learn twice — the operator caught this themselves: *"I think I meant
-- to say pause, which is similar to deactivate."*
INSERT INTO ui_strings (key, locale, value) VALUES ('rule.title', 'en', 'Rule');
INSERT INTO ui_strings (key, locale, value) VALUES ('rule.version', 'en', 'Version {n}');
INSERT INTO ui_strings (key, locale, value) VALUES ('rule.pause', 'en', 'Pause');
INSERT INTO ui_strings (key, locale, value) VALUES ('rule.resume', 'en', 'Resume');
INSERT INTO ui_strings (key, locale, value) VALUES ('rule.newversion', 'en', 'Write a new version');
INSERT INTO ui_strings (key, locale, value) VALUES ('rule.running', 'en', 'This rule runs on invoices reaching this stage.');
INSERT INTO ui_strings (key, locale, value) VALUES ('rule.notrunning', 'en', 'Paused. Invoices reaching this stage are not tested against it.');
INSERT INTO ui_strings (key, locale, value) VALUES ('rule.approvedby', 'en', 'Confirmed by {who} on {when}.');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.newversion', 'en', 'Write a new version');

INSERT INTO ui_strings (key, locale, value) VALUES ('rule.title', 'de', 'Regel');
INSERT INTO ui_strings (key, locale, value) VALUES ('rule.version', 'de', 'Version {n}');
INSERT INTO ui_strings (key, locale, value) VALUES ('rule.pause', 'de', 'Pausieren');
INSERT INTO ui_strings (key, locale, value) VALUES ('rule.resume', 'de', 'Fortsetzen');
INSERT INTO ui_strings (key, locale, value) VALUES ('rule.newversion', 'de', 'Neue Version schreiben');
INSERT INTO ui_strings (key, locale, value) VALUES ('rule.running', 'de', 'Diese Regel läuft für Rechnungen, die diese Stufe erreichen.');
INSERT INTO ui_strings (key, locale, value) VALUES ('rule.notrunning', 'de', 'Pausiert. Rechnungen in dieser Stufe werden nicht dagegen geprüft.');
INSERT INTO ui_strings (key, locale, value) VALUES ('rule.approvedby', 'de', 'Bestätigt von {who} am {when}.');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.newversion', 'de', 'Neue Version schreiben');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'rule.%' == 16
