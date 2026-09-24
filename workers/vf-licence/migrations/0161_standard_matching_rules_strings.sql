-- 0161_standard_matching_rules_strings.sql
-- Standard matching rules — decision 0474. AP Setup's own Matching tab
-- gains a second panel: checkboxes that enable/disable a standard
-- matching rule that already exists (never compile or activate one).

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.standardrules', 'en', 'Standard matching rules'),
 ('apsetup.standardrulessub', 'en', 'Turn a standard matching rule on or off. Authoring one for the first time is done on its own stage''s Rules screen, the same way as any rule.'),
 ('apsetup.standardrulenotcreated', 'en', 'Not yet created.'),
 ('apsetup.standardrulesuggested', 'en', 'Suggested sentence:'),
 ('apsetup.standardrulepending', 'en', 'Compiled but not yet activated — review and activate it on its own stage''s Rules screen before it can be turned on or off here.'),
 ('apsetup.standardrulesavefailed', 'en', 'Could not update that rule');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.standardrules', 'de', 'Standard-Abgleichsregeln'),
 ('apsetup.standardrulessub', 'de', 'Eine Standard-Abgleichsregel ein- oder ausschalten. Das erstmalige Erstellen erfolgt auf der Regeln-Ansicht der jeweiligen Stufe, wie bei jeder Regel.'),
 ('apsetup.standardrulenotcreated', 'de', 'Noch nicht erstellt.'),
 ('apsetup.standardrulesuggested', 'de', 'Vorgeschlagener Satz:'),
 ('apsetup.standardrulepending', 'de', 'Kompiliert, aber noch nicht aktiviert — auf der Regeln-Ansicht der jeweiligen Stufe prüfen und aktivieren, bevor sie hier ein- oder ausgeschaltet werden kann.'),
 ('apsetup.standardrulesavefailed', 'de', 'Diese Regel konnte nicht aktualisiert werden');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('apsetup.standardrules','apsetup.standardrulessub','apsetup.standardrulenotcreated','apsetup.standardrulesuggested','apsetup.standardrulepending','apsetup.standardrulesavefailed') == 12
