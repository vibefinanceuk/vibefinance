-- 0165_stage_restrictions_strings.sql
-- Decision 0483 — the Stage Restrictions tab in AP Setup.
--
-- Reported live: Account Coding was showing up as editable on the
-- Validation stage, when nobody had asked for that — "Coding should
-- only happen in the Coding stage." A route to restrict a field per
-- stage has existed since decision 0143/0196 (PUT /processes/stages/
-- :id/field-visibility), fully tested, with no screen ever built on
-- top of it — this tab is that screen, narrowly for Account Coding's
-- own three fields.
--
-- The operator's own follow-up, and the real business case: a company
-- that outsources document capture and data entry needs Validation
-- done by people who must never be able to code a line, since Account
-- Coding is an AP-team decision — a stage restriction is exactly the
-- right shape for that.
--
-- `field.coding.project`/`field.coding.commodity_code`/
-- `field.coding.gl_code` already exist (migration 0152) and are
-- reused directly as this tab's own field labels, rather than a
-- second set of strings naming the same three things.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.stagerestrictions', 'en', 'Stage Restrictions'),
 ('apsetup.stagerestrictions.sub', 'en', 'What a stage leaves editable beyond its own rule set. A stage may only ever restrict a field further — never grant editing a customer has not already allowed.'),
 ('apsetup.stagerestrictions.process', 'en', 'Process'),
 ('apsetup.stagerestrictions.noprocess', 'en', 'No process configured yet.'),
 ('apsetup.stagerestrictions.fieldsheading', 'en', 'Account Coding editable here'),
 ('apsetup.stagerestrictions.fieldshint', 'en', 'Unchecked hides the field at this stage entirely. Editable everywhere is set from the Account Coding tab.'),
 ('apsetup.stagerestrictions.hiddeneverywhere', 'en', 'Hidden for everyone — set on the Account Coding tab first.'),
 ('apsetup.stagerestrictions.savefailed', 'en', 'Could not save that restriction. Try again.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.stagerestrictions', 'de', 'Phasenbeschränkungen'),
 ('apsetup.stagerestrictions.sub', 'de', 'Was eine Phase über ihr eigenes Regelwerk hinaus bearbeitbar lässt. Eine Phase kann ein Feld nur weiter einschränken — nie eine Bearbeitung erlauben, die ein Kunde nicht bereits zugelassen hat.'),
 ('apsetup.stagerestrictions.process', 'de', 'Prozess'),
 ('apsetup.stagerestrictions.noprocess', 'de', 'Noch kein Prozess eingerichtet.'),
 ('apsetup.stagerestrictions.fieldsheading', 'de', 'Kontierung hier bearbeitbar'),
 ('apsetup.stagerestrictions.fieldshint', 'de', 'Deaktiviert blendet das Feld in dieser Phase vollständig aus. Überall bearbeitbar wird im Reiter Kontierung festgelegt.'),
 ('apsetup.stagerestrictions.hiddeneverywhere', 'de', 'Für alle ausgeblendet — zuerst im Reiter Kontierung festlegen.'),
 ('apsetup.stagerestrictions.savefailed', 'de', 'Diese Einschränkung konnte nicht gespeichert werden. Bitte erneut versuchen.');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('apsetup.stagerestrictions','apsetup.stagerestrictions.sub','apsetup.stagerestrictions.process','apsetup.stagerestrictions.noprocess','apsetup.stagerestrictions.fieldsheading','apsetup.stagerestrictions.fieldshint','apsetup.stagerestrictions.hiddeneverywhere','apsetup.stagerestrictions.savefailed') == 16
