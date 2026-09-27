-- 0185_documents_column_labels.sql
-- Decision 0520. The Documents list's column headings, renamed to the
-- operator's own words: "Document Number (i.e. Invoice Number) ...
-- Received Date, Due Date, Supplier Name". These four keys are only
-- read by documents.js. `column.unit` is left alone because Access's
-- Org Units table reads it too, and `column.status`, `column.amount`
-- and `column.hands` already read as asked.

UPDATE ui_strings SET value = 'Document Number' WHERE key = 'column.number' AND locale = 'en';
UPDATE ui_strings SET value = 'Received Date' WHERE key = 'column.received' AND locale = 'en';
UPDATE ui_strings SET value = 'Due Date' WHERE key = 'column.due' AND locale = 'en';
UPDATE ui_strings SET value = 'Supplier Name' WHERE key = 'column.sender' AND locale = 'en';

UPDATE ui_strings SET value = 'Belegnummer' WHERE key = 'column.number' AND locale = 'de';
UPDATE ui_strings SET value = 'Eingangsdatum' WHERE key = 'column.received' AND locale = 'de';
UPDATE ui_strings SET value = 'Fälligkeitsdatum' WHERE key = 'column.due' AND locale = 'de';
UPDATE ui_strings SET value = 'Lieferantenname' WHERE key = 'column.sender' AND locale = 'de';

-- ASSERT: SELECT value FROM ui_strings WHERE key = 'column.sender' AND locale = 'en' == 'Supplier Name'
