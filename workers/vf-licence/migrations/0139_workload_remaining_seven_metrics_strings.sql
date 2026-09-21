-- 0139_workload_remaining_seven_metrics_strings.sql
--
-- Decision 0428 — Workload's own remaining seven key metrics, built
-- together at the operator's own choice ("all seven together"):
-- open task count by ownership, average handling time by stage/user,
-- claim-to-complete cycle time, tasks pending over a period, team
-- queue depth, workload balance, and exceptions by user.
-- `workload.throughput`/`workload.throughputsub`/`workload.nothroughput`
-- already exist (decision 0415); these are this screen's own last new
-- keys.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('workload.opentasks', 'en', 'Open tasks by user'),
 ('workload.opentaskssub', 'en', 'Who currently owns or has claimed what, and how much sits unclaimed'),
 ('workload.noopentasks', 'en', 'No open tasks right now'),
 ('workload.opentasksavailable', 'en', '{n} unclaimed'),
 ('workload.handlingtime', 'en', 'Average handling time'),
 ('workload.handlingtimesub', 'en', 'Claim to complete, by stage and by user'),
 ('workload.nohandlingtime', 'en', 'No completed, claimed tasks yet'),
 ('workload.stage', 'en', 'Stage'),
 ('workload.user', 'en', 'User'),
 ('workload.avghandlingtime', 'en', 'Avg. handling time'),
 ('workload.taskcount', 'en', 'Tasks'),
 ('workload.hourscount', 'en', '{n} hours'),
 ('workload.cycletime', 'en', 'Claim-to-complete cycle time'),
 ('workload.cycletimesub', 'en', 'How long a task sits once somebody has it'),
 ('workload.nocycletime', 'en', 'No completed, claimed tasks yet'),
 ('workload.taskcountnote', 'en', '{n} tasks'),
 ('workload.pending', 'en', 'Tasks pending action'),
 ('workload.pendingsub', 'en', 'Open longer than 3, 7 or 14 days'),
 ('workload.nopending', 'en', 'Nothing has been open that long'),
 ('workload.dayplusheader', 'en', '{n}+ days'),
 ('workload.unclaimed', 'en', 'Unclaimed'),
 ('workload.queuedepth', 'en', 'Team queue depth'),
 ('workload.queuedepthsub', 'en', 'Available (unclaimed) vs. locked (claimed but not finished), by team'),
 ('workload.noqueuedepth', 'en', 'No team-owned tasks open right now'),
 ('workload.available', 'en', 'Available'),
 ('workload.locked', 'en', 'Locked'),
 ('workload.balance', 'en', 'Workload balance'),
 ('workload.balancesub', 'en', 'Variance in open-task count across each team''s own members'),
 ('workload.nobalance', 'en', 'No teams to compare yet'),
 ('workload.balancestddev', 'en', '±{n} tasks'),
 ('workload.exceptions', 'en', 'Exceptions by user'),
 ('workload.exceptionssub', 'en', 'Not to assign blame — to see where extra support or training would help'),
 ('workload.noexceptions', 'en', 'No exceptions recorded'),
 ('workload.exceptioncount', 'en', '{n} exceptions');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('workload.opentasks', 'de', 'Offene Aufgaben nach Benutzer'),
 ('workload.opentaskssub', 'de', 'Wer derzeit was besitzt oder beansprucht hat, und wie viel unbeansprucht ist'),
 ('workload.noopentasks', 'de', 'Derzeit keine offenen Aufgaben'),
 ('workload.opentasksavailable', 'de', '{n} unbeansprucht'),
 ('workload.handlingtime', 'de', 'Durchschnittliche Bearbeitungszeit'),
 ('workload.handlingtimesub', 'de', 'Von Beanspruchung bis Abschluss, nach Phase und Benutzer'),
 ('workload.nohandlingtime', 'de', 'Noch keine abgeschlossenen, beanspruchten Aufgaben'),
 ('workload.stage', 'de', 'Phase'),
 ('workload.user', 'de', 'Benutzer'),
 ('workload.avghandlingtime', 'de', 'Durchschn. Bearbeitungszeit'),
 ('workload.taskcount', 'de', 'Aufgaben'),
 ('workload.hourscount', 'de', '{n} Stunden'),
 ('workload.cycletime', 'de', 'Durchlaufzeit von Beanspruchung bis Abschluss'),
 ('workload.cycletimesub', 'de', 'Wie lange eine Aufgabe liegt, sobald jemand sie hat'),
 ('workload.nocycletime', 'de', 'Noch keine abgeschlossenen, beanspruchten Aufgaben'),
 ('workload.taskcountnote', 'de', '{n} Aufgaben'),
 ('workload.pending', 'de', 'Ausstehende Aufgaben'),
 ('workload.pendingsub', 'de', 'Länger offen als 3, 7 oder 14 Tage'),
 ('workload.nopending', 'de', 'Nichts war so lange offen'),
 ('workload.dayplusheader', 'de', '{n}+ Tage'),
 ('workload.unclaimed', 'de', 'Unbeansprucht'),
 ('workload.queuedepth', 'de', 'Team-Warteschlangentiefe'),
 ('workload.queuedepthsub', 'de', 'Verfügbar (unbeansprucht) vs. gesperrt (beansprucht, aber nicht abgeschlossen), nach Team'),
 ('workload.noqueuedepth', 'de', 'Derzeit keine team-eigenen Aufgaben offen'),
 ('workload.available', 'de', 'Verfügbar'),
 ('workload.locked', 'de', 'Gesperrt'),
 ('workload.balance', 'de', 'Arbeitslastverteilung'),
 ('workload.balancesub', 'de', 'Varianz der offenen Aufgabenzahl innerhalb der eigenen Mitglieder jedes Teams'),
 ('workload.nobalance', 'de', 'Noch keine Teams zum Vergleichen'),
 ('workload.balancestddev', 'de', '±{n} Aufgaben'),
 ('workload.exceptions', 'de', 'Ausnahmen nach Benutzer'),
 ('workload.exceptionssub', 'de', 'Nicht um Schuld zuzuweisen — um zu sehen, wo zusätzliche Unterstützung oder Schulung helfen würde'),
 ('workload.noexceptions', 'de', 'Keine Ausnahmen erfasst'),
 ('workload.exceptioncount', 'de', '{n} Ausnahmen');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('workload.opentasks','workload.opentaskssub','workload.noopentasks','workload.opentasksavailable','workload.handlingtime','workload.handlingtimesub','workload.nohandlingtime','workload.stage','workload.user','workload.avghandlingtime','workload.taskcount','workload.hourscount','workload.cycletime','workload.cycletimesub','workload.nocycletime','workload.taskcountnote','workload.pending','workload.pendingsub','workload.nopending','workload.dayplusheader','workload.unclaimed','workload.queuedepth','workload.queuedepthsub','workload.noqueuedepth','workload.available','workload.locked','workload.balance','workload.balancesub','workload.nobalance','workload.balancestddev','workload.exceptions','workload.exceptionssub','workload.noexceptions','workload.exceptioncount') == 68
