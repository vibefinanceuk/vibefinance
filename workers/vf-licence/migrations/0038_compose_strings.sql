-- 0038_compose_strings.sql
-- Decision 0153 — the words for writing a rule.
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.title', 'en', 'Write a rule');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.write', 'en', 'What should happen');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.compile', 'en', 'Compile');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.plain', 'en', 'Plain English. If it cannot be expressed, you will be told why.');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.needsentence', 'en', 'Write what should happen first.');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.compiling', 'en', 'Working out what you mean.');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.failed', 'en', 'That did not work.');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.cannot', 'en', 'This cannot be expressed');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.nothingsaved', 'en', 'Nothing was saved. Rewrite the sentence, or ask for a report instead.');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.willdo', 'en', 'What this will do');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.examples', 'en', 'Worked examples');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.examplesnote', 'en', 'Each was run through the real rule. Confirm that every outcome is what you expect.');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.fires', 'en', 'Fires');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.quiet', 'en', 'Stays quiet');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.confirm', 'en', 'Confirm');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.confirmed', 'en', 'Confirmed');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.activate', 'en', 'Activate this rule');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.confirmfirst', 'en', 'Confirm {n} more first.');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.allconfirmed', 'en', 'Every example confirmed.');

INSERT INTO ui_strings (key, locale, value) VALUES ('compose.title', 'de', 'Regel schreiben');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.write', 'de', 'Was geschehen soll');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.compile', 'de', 'Kompilieren');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.plain', 'de', 'In einfachem Deutsch. Lässt es sich nicht ausdrücken, erfahren Sie warum.');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.needsentence', 'de', 'Schreiben Sie zuerst, was geschehen soll.');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.compiling', 'de', 'Wir ermitteln, was Sie meinen.');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.failed', 'de', 'Das hat nicht funktioniert.');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.cannot', 'de', 'Das lässt sich nicht ausdrücken');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.nothingsaved', 'de', 'Es wurde nichts gespeichert. Formulieren Sie den Satz neu oder fragen Sie stattdessen einen Bericht an.');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.willdo', 'de', 'Was diese Regel tut');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.examples', 'de', 'Durchgerechnete Beispiele');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.examplesnote', 'de', 'Jedes wurde mit der echten Regel geprüft. Bestätigen Sie, dass jedes Ergebnis Ihrer Erwartung entspricht.');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.fires', 'de', 'Greift');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.quiet', 'de', 'Bleibt still');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.confirm', 'de', 'Bestätigen');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.confirmed', 'de', 'Bestätigt');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.activate', 'de', 'Regel aktivieren');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.confirmfirst', 'de', 'Bestätigen Sie zuerst {n} weitere.');
INSERT INTO ui_strings (key, locale, value) VALUES ('compose.allconfirmed', 'de', 'Alle Beispiele bestätigt.');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'compose.%' == 38
