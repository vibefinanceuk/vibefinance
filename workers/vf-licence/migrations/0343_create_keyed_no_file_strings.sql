-- 0343_create_keyed_no_file_strings.sql
-- Decision 0744 — Create an invoice is keyed from nothing; a file, self-billed or not, goes through Upload documents.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('create.uploadselfbilled', 'en', 'Self-billed invoices'),
 ('create.uploadselfbilled', 'de', 'Gutschriften (Selbstfakturierung)'),
 ('create.uploadselfbilledhint', 'en', 'Tick before dropping the files: every invoice in this upload is one you issue on the supplier''s behalf, under a self-billing agreement, and is marked with invoice type 389.'),
 ('create.uploadselfbilledhint', 'de', 'Vor dem Ablegen der Dateien ankreuzen: Jede Rechnung dieses Uploads stellen Sie im Namen des Lieferanten aus, im Rahmen einer Gutschriftsvereinbarung, und sie wird mit dem Rechnungstyp 389 gekennzeichnet.');

UPDATE ui_strings SET value = 'One invoice you key yourself, from nothing. It opens straight away, for you to claim and key. To start from a file, use Upload documents.' WHERE key = 'create.keyedintro' AND locale = 'en';
UPDATE ui_strings SET value = 'Eine Rechnung, die Sie selbst erfassen, ohne Vorlage. Sie öffnet sich sofort, zum Übernehmen und Erfassen. Um von einer Datei auszugehen, nutzen Sie Dokumente hochladen.' WHERE key = 'create.keyedintro' AND locale = 'de';
UPDATE ui_strings SET value = 'Key an invoice from nothing, header and lines, self-billed if you issue it. To start from a file, use Upload documents.' WHERE key = 'create.keyed.help' AND locale = 'en';
UPDATE ui_strings SET value = 'Eine Rechnung ohne Vorlage erfassen, Kopf und Positionen, als Gutschrift (Selbstfakturierung), wenn Sie sie ausstellen. Um von einer Datei auszugehen, nutzen Sie Dokumente hochladen.' WHERE key = 'create.keyed.help' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('create.uploadselfbilled', 'create.uploadselfbilledhint') == 4
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('create.keyedintro', 'create.keyed.help') AND (value LIKE '%Upload documents.' OR value LIKE '%Dokumente hochladen.') == 4
