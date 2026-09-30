-- 0225_csv_several_invoices_strings.sql
-- Decision 0577. A supplier's CSV holding several invoices is read as one
-- invoice each, no longer refused: the Route monitor names the split, and
-- the mapping help and the CSV fix no longer say one invoice per file.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('routemonitor.event.csv_split', 'en', 'Split into invoices'),
 ('routemonitor.event.csv_split', 'de', 'In Rechnungen aufgeteilt');

UPDATE ui_strings SET value = '- Several invoices in one file. Where the invoice number differs between rows, each invoice''s rows are read as a file of their own and each becomes an invoice. Any that cannot be read are named in the Route monitor, with why.' WHERE key = 'help.screen.mapping.42' AND locale = 'en';
UPDATE ui_strings SET value = '- Mehrere Rechnungen in einer Datei. Unterscheidet sich die Rechnungsnummer zwischen Zeilen, werden die Zeilen jeder Rechnung wie eine eigene Datei gelesen, und jede wird eine Rechnung. Nicht lesbare werden im Routen-Monitor genannt, mit Grund.' WHERE key = 'help.screen.mapping.42' AND locale = 'de';
UPDATE ui_strings SET value = 'Open the mapping, change the line, its function or how the file is read, publish, then reprocess.' WHERE key = 'routemonitor.error.mapping_failed_csv.fix' AND locale = 'en';
UPDATE ui_strings SET value = 'Öffnen Sie die Zuordnung, ändern Sie die Zeile, ihre Funktion oder wie die Datei gelesen wird, veröffentlichen Sie und verarbeiten Sie erneut.' WHERE key = 'routemonitor.error.mapping_failed_csv.fix' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'routemonitor.event.csv_split' == 2
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'help.screen.mapping.42' AND value LIKE '%Several invoices in one file%' == 1
