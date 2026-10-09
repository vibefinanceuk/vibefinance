-- 0318_line_tasks_strings.sql
-- Decision 0709 — Tasks for lines: a stage evaluated once per line can give
-- the lines going to the same team, person and permission one task. Set in
-- a stage's settings in Processes, opened by clicking a draft stage's name.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('processes.linetasks', 'en', 'Tasks for lines'),
 ('processes.linetasks', 'de', 'Aufgaben für Positionen'),
 ('processes.linetasks.combined', 'en', 'Combined by who handles them'),
 ('processes.linetasks.combined', 'de', 'Zusammengefasst nach Bearbeiter'),
 ('processes.linetasks.combined.help', 'en', 'Lines going to the same team, person and permission share one task. At Matching that is one task per invoice, and at Approval one per approver.'),
 ('processes.linetasks.combined.help', 'de', 'Positionen für dasselbe Team, dieselbe Person und dieselbe Berechtigung teilen sich eine Aufgabe. Beim Abgleich ist das eine Aufgabe pro Rechnung und bei der Freigabe eine pro Freigebendem.'),
 ('processes.linetasks.per_line', 'en', 'One per line'),
 ('processes.linetasks.per_line', 'de', 'Eine pro Position'),
 ('processes.linetasks.per_line.help', 'en', 'Each line that needs attention has its own task, even for the same person.'),
 ('processes.linetasks.per_line.help', 'de', 'Jede Position, die Aufmerksamkeit braucht, erhält eine eigene Aufgabe, auch für dieselbe Person.'),
 ('processes.editstage', 'en', 'Stage settings'),
 ('processes.editstage', 'de', 'Stufeneinstellungen'),
 ('processes.editstagenote', 'en', 'Applies to the next invoice to reach this stage, whether or not the draft is published. Tasks already open stay as they are.'),
 ('processes.editstagenote', 'de', 'Gilt für die nächste Rechnung, die diese Stufe erreicht, unabhängig davon, ob der Entwurf veröffentlicht ist. Bereits offene Aufgaben bleiben unverändert.'),
 ('tasks.lines', 'en', 'lines'),
 ('tasks.lines', 'de', 'Positionen');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'processes.linetasks%' OR key IN ('processes.editstage', 'processes.editstagenote', 'tasks.lines') == 16
