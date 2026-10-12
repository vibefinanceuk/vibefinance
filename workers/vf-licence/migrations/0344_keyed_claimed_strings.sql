-- 0344_keyed_claimed_strings.sql
-- Decision 0745 — an invoice created by hand is claimed for whoever created it.

UPDATE ui_strings SET value = 'One invoice you key yourself, from nothing. It opens straight away, already claimed for you to key. To start from a file, use Upload documents.' WHERE key = 'create.keyedintro' AND locale = 'en';
UPDATE ui_strings SET value = 'Eine Rechnung, die Sie selbst erfassen, ohne Vorlage. Sie öffnet sich sofort, für Sie übernommen, zum Erfassen. Um von einer Datei auszugehen, nutzen Sie Dokumente hochladen.' WHERE key = 'create.keyedintro' AND locale = 'de';
UPDATE ui_strings SET value = 'The invoice you create is listed here, and opens already claimed for you to key.' WHERE key = 'create.nothingkeyed' AND locale = 'en';
UPDATE ui_strings SET value = 'Die erstellte Rechnung erscheint hier und öffnet sich, für Sie übernommen, zum Erfassen.' WHERE key = 'create.nothingkeyed' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'create.keyedintro' AND (value LIKE '%claimed for you to key%' OR value LIKE '%für Sie übernommen%') == 2
