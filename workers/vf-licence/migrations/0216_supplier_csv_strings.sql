-- 0216_supplier_csv_strings.sql
-- Decision 0565. Routes phase 2, slice 3: a supplier's own CSV, mapped like
-- its XML. The format on Routes and in the monitor, the monitor's words for a
-- CSV, the editor's CSV options and column groups, a whole-invoice amount
-- added up from the lines, and help.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('routes.format.supplier_csv', 'en', 'A supplier''s CSV'),
 ('routes.format.supplier_csv', 'de', 'CSV eines Lieferanten'),
 ('routes.formats.supplier_csv', 'en', 'A supplier''s CSV'),
 ('routes.formats.supplier_csv', 'de', 'CSV eines Lieferanten'),
 ('routes.formats.supplier_csv.syntax', 'en', 'Columns, one row per line'),
 ('routes.formats.supplier_csv.syntax', 'de', 'Spalten, eine Zeile je Position'),
 ('routes.formats.supplier_csv.how', 'en', 'As data, with that supplier''s mapping'),
 ('routes.formats.supplier_csv.how', 'de', 'Als Daten, mit der Zuordnung dieses Lieferanten'),
 ('routes.formats.supplier_csv.checked', 'en', 'EN 16931, after translation'),
 ('routes.formats.supplier_csv.checked', 'de', 'EN 16931, nach der Übersetzung'),
 ('routemonitor.error.no_mapping_csv.title', 'en', 'A supplier''s CSV, and no mapping reads it yet'),
 ('routemonitor.error.no_mapping_csv.title', 'de', 'CSV eines Lieferanten, noch ohne Zuordnung'),
 ('routemonitor.error.no_mapping_csv.body', 'en', 'The file is a CSV: columns, with a row for each invoice line. No mapping on this route reads CSV files from this sender yet. It is kept, and nothing is lost.'),
 ('routemonitor.error.no_mapping_csv.body', 'de', 'Die Datei ist eine CSV: Spalten, mit einer Zeile je Rechnungsposition. Noch keine Zuordnung auf dieser Route liest CSV-Dateien dieses Absenders. Sie ist gespeichert, nichts geht verloren.'),
 ('routemonitor.error.no_mapping_csv.fix', 'en', 'Map this format from the file below, publish the mapping, then reprocess. Every CSV like it from this sender is then read as data.'),
 ('routemonitor.error.no_mapping_csv.fix', 'de', 'Ordnen Sie das Format aus der Datei unten zu, veröffentlichen Sie die Zuordnung und verarbeiten Sie erneut. Jede solche CSV dieses Absenders wird dann als Daten gelesen.'),
 ('routemonitor.error.mapping_failed_csv.title', 'en', 'The supplier''s CSV mapping could not read it'),
 ('routemonitor.error.mapping_failed_csv.title', 'de', 'Die CSV-Zuordnung des Lieferanten konnte sie nicht lesen'),
 ('routemonitor.error.mapping_failed_csv.body', 'en', 'The file is the supplier''s CSV, and its mapping ran, but a value was not in the form it expects, a column it reads is missing, or the file holds more than one invoice. Which, and why, is shown below.'),
 ('routemonitor.error.mapping_failed_csv.body', 'de', 'Die Datei ist die CSV des Lieferanten und seine Zuordnung lief, aber ein Wert hatte nicht die erwartete Form, eine gelesene Spalte fehlt, oder die Datei enthält mehr als eine Rechnung. Was und warum, steht unten.'),
 ('routemonitor.error.mapping_failed_csv.fix', 'en', 'Open the mapping, change the line, its function or how the file is read, publish, then reprocess. A file with several invoices is sent again as one file per invoice.'),
 ('routemonitor.error.mapping_failed_csv.fix', 'de', 'Öffnen Sie die Zuordnung, ändern Sie die Zeile, ihre Funktion oder wie die Datei gelesen wird, veröffentlichen Sie und verarbeiten Sie erneut. Eine Datei mit mehreren Rechnungen wird als eine Datei je Rechnung erneut gesendet.'),
 ('routemonitor.nomappingwhy_csv', 'en', 'This supplier sends a CSV. Map it once, from this file, and every CSV like it is read as data.'),
 ('routemonitor.nomappingwhy_csv', 'de', 'Dieser Lieferant sendet eine CSV. Ordnen Sie sie einmal aus dieser Datei zu, dann wird jede solche CSV als Daten gelesen.'),
 ('mapping.csv.heading', 'en', 'CSV file → EN 16931 invoice'),
 ('mapping.csv.heading', 'de', 'CSV-Datei → EN-16931-Rechnung'),
 ('mapping.csv.receivingsub', 'en', 'The supplier''s CSV · column and sample value'),
 ('mapping.csv.receivingsub', 'de', 'Die CSV des Lieferanten · Spalte und Beispielwert'),
 ('mapping.csv.first', 'en', 'First row · the whole invoice'),
 ('mapping.csv.first', 'de', 'Erste Zeile · die ganze Rechnung'),
 ('mapping.csv.rows', 'en', 'Every row · each line'),
 ('mapping.csv.rows', 'de', 'Jede Zeile · jede Position'),
 ('mapping.csv.delimiter', 'en', 'Separator'),
 ('mapping.csv.delimiter', 'de', 'Trennzeichen'),
 ('mapping.csv.delim.semicolon', 'en', 'Semicolon'),
 ('mapping.csv.delim.semicolon', 'de', 'Semikolon'),
 ('mapping.csv.delim.comma', 'en', 'Comma'),
 ('mapping.csv.delim.comma', 'de', 'Komma'),
 ('mapping.csv.delim.tab', 'en', 'Tab'),
 ('mapping.csv.delim.tab', 'de', 'Tabulator'),
 ('mapping.csv.delim.bar', 'en', 'Vertical bar'),
 ('mapping.csv.delim.bar', 'de', 'Senkrechter Strich'),
 ('mapping.csv.header', 'en', 'Column names'),
 ('mapping.csv.header', 'de', 'Spaltennamen'),
 ('mapping.csv.headeryes', 'en', 'The first row holds them'),
 ('mapping.csv.headeryes', 'de', 'Die erste Zeile enthält sie'),
 ('mapping.csv.skip', 'en', 'Skip at the top'),
 ('mapping.csv.skip', 'de', 'Oben überspringen'),
 ('mapping.sumlines', 'en', 'An amount for the whole invoice, drawn from the lines: every line''s value is read, then added up.'),
 ('mapping.sumlines', 'de', 'Ein Betrag für die ganze Rechnung aus den Positionen: Der Wert jeder Position wird gelesen und dann addiert.'),
 ('help.screen.mapping.38', 'en', '## A supplier''s CSV'),
 ('help.screen.mapping.38', 'de', '## Die CSV eines Lieferanten'),
 ('help.screen.mapping.39', 'en', '- A CSV is mapped like XML. On the left, First row holds each column''s value in the first row, for terms of the whole invoice. Every row holds the columns for each line.'),
 ('help.screen.mapping.39', 'de', '- Eine CSV wird wie XML zugeordnet. Links enthält Erste Zeile den Wert jeder Spalte in der ersten Zeile, für Angaben der ganzen Rechnung. Jede Zeile enthält die Spalten für jede Position.'),
 ('help.screen.mapping.40', 'en', '- How the file is read is on the Mapping card: the separator, whether the first row holds column names, and lines to skip at the top, such as a title. They are guessed from the file. Change them and the columns follow.'),
 ('help.screen.mapping.40', 'de', '- Wie die Datei gelesen wird, steht auf der Karte Zuordnung: das Trennzeichen, ob die erste Zeile Spaltennamen enthält, und oben zu überspringende Zeilen, etwa ein Titel. Sie werden aus der Datei erraten. Ändern Sie sie, folgen die Spalten.'),
 ('help.screen.mapping.41', 'en', '- A whole-invoice amount can come from a column on every row: the net total from the Netto column, say. Each row''s value is read, then they are added up.'),
 ('help.screen.mapping.41', 'de', '- Ein Betrag der ganzen Rechnung kann aus einer Spalte jeder Zeile kommen, etwa die Nettosumme aus der Spalte Netto. Der Wert jeder Zeile wird gelesen und dann addiert.'),
 ('help.screen.mapping.42', 'en', '- One invoice per file. A file whose invoice number differs between rows is refused, naming the numbers.'),
 ('help.screen.mapping.42', 'de', '- Eine Rechnung je Datei. Eine Datei, deren Rechnungsnummer sich zwischen Zeilen unterscheidet, wird abgelehnt, mit den Nummern.'),
 ('help.screen.mapping.43', 'en', '- Files in UTF-8 and in Windows-1252, as Excel saves them, are both read.'),
 ('help.screen.mapping.43', 'de', '- Dateien in UTF-8 und in Windows-1252, wie Excel sie speichert, werden beide gelesen.'),
 ('help.screen.routes.9', 'en', '- A supplier''s CSV is mapped the same way, from a failed CSV in the Route monitor.'),
 ('help.screen.routes.9', 'de', '- Die CSV eines Lieferanten wird genauso zugeordnet, aus einer fehlgeschlagenen CSV im Routen-Monitor.');

UPDATE ui_strings SET value = 'That term belongs to the whole invoice: choose an element outside the lines. An amount may also come from inside the lines, which adds them up.' WHERE key = 'mapping.scope.header' AND locale = 'en';
UPDATE ui_strings SET value = 'Diese Angabe gehört zur ganzen Rechnung: Wählen Sie ein Element außerhalb der Positionen. Ein Betrag kann auch aus den Positionen kommen, die dann addiert werden.' WHERE key = 'mapping.scope.header' AND locale = 'de';
UPDATE ui_strings SET value = '## A supplier''s own XML or CSV' WHERE key = 'help.screen.routemonitor.4' AND locale = 'en';
UPDATE ui_strings SET value = '## Eigenes XML oder CSV eines Lieferanten' WHERE key = 'help.screen.routemonitor.4' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('routes.format.supplier_csv','routes.formats.supplier_csv','routes.formats.supplier_csv.syntax','routes.formats.supplier_csv.how','routes.formats.supplier_csv.checked','routemonitor.error.no_mapping_csv.title','routemonitor.error.no_mapping_csv.body','routemonitor.error.no_mapping_csv.fix','routemonitor.error.mapping_failed_csv.title','routemonitor.error.mapping_failed_csv.body','routemonitor.error.mapping_failed_csv.fix','routemonitor.nomappingwhy_csv','mapping.csv.heading','mapping.csv.receivingsub','mapping.csv.first','mapping.csv.rows','mapping.csv.delimiter','mapping.csv.delim.semicolon','mapping.csv.delim.comma','mapping.csv.delim.tab','mapping.csv.delim.bar','mapping.csv.header','mapping.csv.headeryes','mapping.csv.skip','mapping.sumlines','help.screen.mapping.38','help.screen.mapping.39','help.screen.mapping.40','help.screen.mapping.41','help.screen.mapping.42','help.screen.mapping.43','help.screen.routes.9') == 64
-- ASSERT: SELECT count(*) FROM ui_strings WHERE (key = 'mapping.scope.header' AND (value LIKE '%adds them up%' OR value LIKE '%addiert%')) OR (key = 'help.screen.routemonitor.4' AND value LIKE '%CSV%') == 4
