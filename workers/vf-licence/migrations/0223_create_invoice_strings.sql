-- 0223_create_invoice_strings.sql
-- Decision 0575. Create, Create an invoice: an invoice keyed by hand, optionally
-- from a file, optionally self-billed, with its Timeline line and help.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('create.keyed', 'en', 'Create an invoice'),
 ('create.keyed', 'de', 'Rechnung erfassen'),
 ('create.keyedintro', 'en', 'One invoice you key yourself, from a file or from nothing. It opens straight away, for you to claim and key.'),
 ('create.keyedintro', 'de', 'Eine Rechnung, die Sie selbst erfassen, aus einer Datei oder ohne. Sie öffnet sich sofort, zum Übernehmen und Erfassen.'),
 ('create.startfrom', 'en', 'Start from a file (optional)'),
 ('create.startfrom', 'de', 'Aus einer Datei beginnen (optional)'),
 ('create.startfromhint', 'en', 'A PDF, image or XML invoice is read first, so the form opens filled in. Without one, it opens empty.'),
 ('create.startfromhint', 'de', 'Ein PDF, Bild oder eine XML-Rechnung wird zuerst gelesen, damit das Formular ausgefüllt öffnet. Ohne Datei öffnet es leer.'),
 ('create.nofile', 'en', 'No file'),
 ('create.nofile', 'de', 'Keine Datei'),
 ('create.choosefile', 'en', 'Choose file'),
 ('create.choosefile', 'de', 'Datei wählen'),
 ('create.removefile', 'en', 'Remove'),
 ('create.removefile', 'de', 'Entfernen'),
 ('create.selfbilled', 'en', 'Self-billed invoice'),
 ('create.selfbilled', 'de', 'Gutschrift (Selbstfakturierung)'),
 ('create.selfbilledhint', 'en', 'You issue this invoice on the supplier''s behalf, under a self-billing agreement with them. It is marked with invoice type 389.'),
 ('create.selfbilledhint', 'de', 'Sie stellen diese Rechnung im Namen des Lieferanten aus, auf Grundlage einer Gutschriftvereinbarung mit ihm. Sie erhält die Rechnungsart 389.'),
 ('create.createinvoice', 'en', 'Create invoice'),
 ('create.createinvoice', 'de', 'Rechnung erstellen'),
 ('create.nothingkeyed', 'en', 'The invoice you create is listed here, and opens for you to claim and key.'),
 ('create.nothingkeyed', 'de', 'Die erstellte Rechnung erscheint hier und öffnet sich zum Übernehmen und Erfassen.'),
 ('create.keyedrow', 'en', 'Invoice keyed by hand'),
 ('create.keyedrow', 'de', 'Von Hand erfasste Rechnung'),
 ('activity.receivedkeyed', 'en', 'Created by hand by {sender}, message {message}'),
 ('activity.receivedkeyed', 'de', 'Von Hand erstellt von {sender}, Nachricht {message}'),
 ('routemonitor.event.invoice_keyed', 'en', 'Invoice keyed by hand'),
 ('routemonitor.event.invoice_keyed', 'de', 'Rechnung von Hand erfasst'),
 ('help.screen.create.8', 'en', '## Create an invoice'),
 ('help.screen.create.8', 'de', '## Rechnung erfassen'),
 ('help.screen.create.9', 'en', '- One invoice you key yourself. Choose where it goes, and optionally a PDF, image or XML file to start from: it is read first, so the form opens filled in.'),
 ('help.screen.create.9', 'de', '- Eine Rechnung, die Sie selbst erfassen. Wählen Sie, wohin sie geht, und optional eine PDF-, Bild- oder XML-Datei als Ausgangspunkt: Sie wird zuerst gelesen, damit das Formular ausgefüllt öffnet.'),
 ('help.screen.create.10', 'en', '- Tick Self-billed invoice when you issue it on the supplier''s behalf under a self-billing agreement. It is marked with invoice type 389, which a rule can test.'),
 ('help.screen.create.10', 'de', '- Kreuzen Sie Gutschrift an, wenn Sie die Rechnung im Namen des Lieferanten auf Grundlage einer Gutschriftvereinbarung ausstellen. Sie erhält die Rechnungsart 389, die eine Regel prüfen kann.'),
 ('help.screen.create.11', 'en', '- Create invoice makes it and opens it: claim it and key the fields as at Validation. It then goes through the whole process, and its Timeline says you created it by hand.'),
 ('help.screen.create.11', 'de', '- Rechnung erstellen legt sie an und öffnet sie: Übernehmen Sie sie und erfassen Sie die Felder wie bei der Prüfung. Danach durchläuft sie den ganzen Prozess, und ihre Zeitleiste zeigt, dass Sie sie von Hand erstellt haben.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('create.keyed','create.keyedintro','create.startfrom','create.startfromhint','create.nofile','create.choosefile','create.removefile','create.selfbilled','create.selfbilledhint','create.createinvoice','create.nothingkeyed','create.keyedrow','activity.receivedkeyed','routemonitor.event.invoice_keyed','help.screen.create.8','help.screen.create.9','help.screen.create.10','help.screen.create.11') == 36
