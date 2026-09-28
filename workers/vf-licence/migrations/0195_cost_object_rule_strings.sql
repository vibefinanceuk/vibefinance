-- 0195_cost_object_rule_strings.sql
-- Decision 0540. AP Setup's Cost centre / Project rule, the Coding
-- pop-out's switch between the two, and what Save and Complete say
-- about a line holding neither or both.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('field.cost_object', 'en', 'Cost centre or project'),
 ('viewer.coding.invalid.both', 'en', 'has both a cost centre and a project. Keep one'),
 ('viewer.coding.bothrefused', 'en', 'Not saved. A line carries a cost centre or a project, not both (line {lines}).'),
 ('apsetup.costobject.title', 'en', 'Cost centre and project'),
 ('apsetup.costobject.sub', 'en', 'How a coded line is charged: to a department''s cost centre, or to a project.'),
 ('apsetup.costobject.exclusive', 'en', 'One or the other (recommended)'),
 ('apsetup.costobject.exclusive.help', 'en', 'Each line carries a cost centre or a project, never both. Choosing one clears the other, and Complete at a coding stage needs one of them.'),
 ('apsetup.costobject.both', 'en', 'Both allowed'),
 ('apsetup.costobject.both.help', 'en', 'A line may carry a cost centre and a project together, for example a project line also booked to its owning department.'),
 ('apsetup.costobject.savefailed', 'en', 'Could not save the cost centre and project setting.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('field.cost_object', 'de', 'Kostenstelle oder Projekt'),
 ('viewer.coding.invalid.both', 'de', 'hat Kostenstelle und Projekt. Nur eines behalten'),
 ('viewer.coding.bothrefused', 'de', 'Nicht gespeichert. Eine Position trägt eine Kostenstelle oder ein Projekt, nicht beides (Position {lines}).'),
 ('apsetup.costobject.title', 'de', 'Kostenstelle und Projekt'),
 ('apsetup.costobject.sub', 'de', 'Wie eine kontierte Position belastet wird: auf die Kostenstelle einer Abteilung oder auf ein Projekt.'),
 ('apsetup.costobject.exclusive', 'de', 'Entweder oder (empfohlen)'),
 ('apsetup.costobject.exclusive.help', 'de', 'Jede Position trägt eine Kostenstelle oder ein Projekt, nie beides. Die Wahl des einen leert das andere, und Abschließen in einer Kontierungsstufe verlangt eines von beiden.'),
 ('apsetup.costobject.both', 'de', 'Beides erlaubt'),
 ('apsetup.costobject.both.help', 'de', 'Eine Position darf Kostenstelle und Projekt zugleich tragen, etwa eine Projektposition, die auch auf die zuständige Abteilung gebucht wird.'),
 ('apsetup.costobject.savefailed', 'de', 'Die Einstellung zu Kostenstelle und Projekt konnte nicht gespeichert werden.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'field.cost_object' OR key = 'viewer.coding.invalid.both' OR key = 'viewer.coding.bothrefused' OR key LIKE 'apsetup.costobject.%' == 20
