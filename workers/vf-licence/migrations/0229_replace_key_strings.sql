-- 0229_replace_key_strings.sql
-- Decision 0581. Replace an HTTPS key: a new key with the same name, the old
-- one stopping in 24 hours or at once, and the screen's help.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('httpsin.replace', 'en', 'Replace'),
 ('httpsin.replace', 'de', 'Ersetzen'),
 ('httpsin.replacetitle', 'en', 'Replace this key?'),
 ('httpsin.replacetitle', 'de', 'Diesen Schlüssel ersetzen?'),
 ('httpsin.replacesub', 'en', '{name} gets a new key with the same name, shown once. Supplier mappings that name {name} keep reading what it sends.'),
 ('httpsin.replacesub', 'de', '{name} erhält einen neuen Schlüssel mit demselben Namen, einmal angezeigt. Lieferantenzuordnungen, die {name} nennen, lesen weiter, was damit gesendet wird.'),
 ('httpsin.stopnow', 'en', 'Stop the old key now'),
 ('httpsin.stopnow', 'de', 'Den alten Schlüssel sofort stoppen'),
 ('httpsin.stopnowhint', 'en', 'Otherwise the old key keeps working for 24 hours, so the sender can switch without a gap. Stop it now if it may have leaked.'),
 ('httpsin.stopnowhint', 'de', 'Sonst funktioniert der alte Schlüssel noch 24 Stunden, damit der Sender ohne Unterbrechung wechseln kann. Stoppen Sie ihn sofort, wenn er bekannt geworden sein könnte.'),
 ('httpsin.replacedstops', 'en', 'Replaced · stops {when}'),
 ('httpsin.replacedstops', 'de', 'Ersetzt · endet {when}'),
 ('httpsin.stoppedon', 'en', 'Stopped {when}'),
 ('httpsin.stoppedon', 'de', 'Beendet {when}');

UPDATE ui_strings SET value = 'Where each process takes information in and sends it out. Sources deliver to the process''s first stage, Destinations read from its last. Choose a source to give it an address, set its org, rename or retire it, or add a new one. An HTTPS source has its own address and keys: make a key for each system that sends, shown once. Replace a lost key with a new one of the same name, and revoke one without stopping the others.' WHERE key = 'help.screen.processroutes' AND locale = 'en';
UPDATE ui_strings SET value = 'Wo jeder Prozess Informationen aufnimmt und abgibt. Quellen liefern an die erste Stufe des Prozesses, Ziele lesen aus der letzten. Wählen Sie eine Quelle, um ihr eine Adresse zu geben, ihre Organisation festzulegen, sie umzubenennen oder stillzulegen, oder fügen Sie eine neue hinzu. Eine HTTPS-Quelle hat eine eigene Adresse und Schlüssel: Erstellen Sie einen Schlüssel für jedes sendende System, einmal angezeigt. Ersetzen Sie einen verlorenen Schlüssel durch einen neuen mit demselben Namen, und widerrufen Sie einen, ohne die anderen anzuhalten.' WHERE key = 'help.screen.processroutes' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('httpsin.replace','httpsin.replacetitle','httpsin.replacesub','httpsin.stopnow','httpsin.stopnowhint','httpsin.replacedstops','httpsin.stoppedon') == 14
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'help.screen.processroutes' AND value LIKE '%Replace a lost key%' == 1
