-- 0186_tasks_column_labels.sql
-- Decision 0521. The Tasks list, in the operator's own order: "Document
-- Number, Stage, Amount, Received Date, Waiting, Supplier Name, Owner,
-- Action (I.e. Claim)". This adds three new headings and renames
-- Supplier to Supplier Name. `tasks.supplier` is read only by the Tasks
-- list.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('tasks.document', 'en', 'Document Number'),
 ('tasks.received', 'en', 'Received Date'),
 ('tasks.action', 'en', 'Action');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('tasks.document', 'de', 'Belegnummer'),
 ('tasks.received', 'de', 'Eingangsdatum'),
 ('tasks.action', 'de', 'Aktion');

UPDATE ui_strings SET value = 'Supplier Name' WHERE key = 'tasks.supplier' AND locale = 'en';
UPDATE ui_strings SET value = 'Lieferantenname' WHERE key = 'tasks.supplier' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('tasks.document', 'tasks.received', 'tasks.action') == 6
