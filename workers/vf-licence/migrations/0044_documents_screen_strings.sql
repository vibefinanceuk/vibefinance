-- 0044_documents_screen_strings.sql
-- Decision 0164 — the document manager.
INSERT INTO ui_strings (key, locale, value) VALUES ('nav.documents', 'en', 'Documents');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.subtitle', 'en', 'Everything that has arrived, whether or not anybody had to look at it');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.searchhint', 'en', 'Supplier, document number, or amount');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.choosecolumns', 'en', 'Choose columns');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.none', 'en', 'Nothing has arrived yet.');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.nomatch', 'en', 'Nothing matches that. Try a supplier name, a document number, or an amount.');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.searchedcount', 'en', '{shown} of the {searched} most recent.');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.unreadable', 'en', 'Could not be read automatically');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.notread', 'en', 'Not read');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.unknownsender', 'en', 'Unknown');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.noprocess', 'en', 'Finished');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.straightthrough', 'en', 'Straight through');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.handcount', 'en', '{n} touched it');
-- The columns, named as a person would.
INSERT INTO ui_strings (key, locale, value) VALUES ('column.number', 'en', 'Document');
INSERT INTO ui_strings (key, locale, value) VALUES ('column.type', 'en', 'Type');
INSERT INTO ui_strings (key, locale, value) VALUES ('column.status', 'en', 'Status');
INSERT INTO ui_strings (key, locale, value) VALUES ('column.amount', 'en', 'Amount');
INSERT INTO ui_strings (key, locale, value) VALUES ('column.sender', 'en', 'Sender');
INSERT INTO ui_strings (key, locale, value) VALUES ('column.recipient', 'en', 'Recipient');
INSERT INTO ui_strings (key, locale, value) VALUES ('column.received', 'en', 'Received');
INSERT INTO ui_strings (key, locale, value) VALUES ('column.due', 'en', 'Due');
INSERT INTO ui_strings (key, locale, value) VALUES ('column.stage', 'en', 'Stage');
INSERT INTO ui_strings (key, locale, value) VALUES ('column.hands', 'en', 'Hands');
INSERT INTO ui_strings (key, locale, value) VALUES ('column.expand', 'en', 'Expand');
-- Where a document stands, as one word rather than three columns.
INSERT INTO ui_strings (key, locale, value) VALUES ('docstatus.waiting', 'en', 'Waiting');
INSERT INTO ui_strings (key, locale, value) VALUES ('docstatus.moving', 'en', 'In progress');
INSERT INTO ui_strings (key, locale, value) VALUES ('docstatus.done', 'en', 'Finished');
INSERT INTO ui_strings (key, locale, value) VALUES ('docstatus.unreadable', 'en', 'Needs keying');
INSERT INTO ui_strings (key, locale, value) VALUES ('docstatus.outside', 'en', 'Not in a process');
-- The EN 16931 type codes, in words (decision 0113's own list).
INSERT INTO ui_strings (key, locale, value) VALUES ('doctype.380', 'en', 'Invoice');
INSERT INTO ui_strings (key, locale, value) VALUES ('doctype.381', 'en', 'Credit note');
INSERT INTO ui_strings (key, locale, value) VALUES ('doctype.389', 'en', 'Self-billed invoice');
INSERT INTO ui_strings (key, locale, value) VALUES ('doctype.unknown', 'en', 'Unknown');

INSERT INTO ui_strings (key, locale, value) VALUES ('nav.documents', 'de', 'Dokumente');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.subtitle', 'de', 'Alles, was eingegangen ist — ob jemand es ansehen musste oder nicht');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.searchhint', 'de', 'Lieferant, Belegnummer oder Betrag');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.choosecolumns', 'de', 'Spalten wählen');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.none', 'de', 'Es ist noch nichts eingegangen.');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.nomatch', 'de', 'Dazu passt nichts. Versuchen Sie einen Lieferanten, eine Belegnummer oder einen Betrag.');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.searchedcount', 'de', '{shown} von den {searched} neuesten.');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.unreadable', 'de', 'Konnte nicht automatisch gelesen werden');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.notread', 'de', 'Nicht gelesen');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.unknownsender', 'de', 'Unbekannt');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.noprocess', 'de', 'Abgeschlossen');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.straightthrough', 'de', 'Ohne Eingriff');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.handcount', 'de', 'Von {n} bearbeitet');
INSERT INTO ui_strings (key, locale, value) VALUES ('column.number', 'de', 'Beleg');
INSERT INTO ui_strings (key, locale, value) VALUES ('column.type', 'de', 'Art');
INSERT INTO ui_strings (key, locale, value) VALUES ('column.status', 'de', 'Status');
INSERT INTO ui_strings (key, locale, value) VALUES ('column.amount', 'de', 'Betrag');
INSERT INTO ui_strings (key, locale, value) VALUES ('column.sender', 'de', 'Absender');
INSERT INTO ui_strings (key, locale, value) VALUES ('column.recipient', 'de', 'Empfänger');
INSERT INTO ui_strings (key, locale, value) VALUES ('column.received', 'de', 'Eingegangen');
INSERT INTO ui_strings (key, locale, value) VALUES ('column.due', 'de', 'Fällig');
INSERT INTO ui_strings (key, locale, value) VALUES ('column.stage', 'de', 'Stufe');
INSERT INTO ui_strings (key, locale, value) VALUES ('column.hands', 'de', 'Bearbeitung');
INSERT INTO ui_strings (key, locale, value) VALUES ('column.expand', 'de', 'Öffnen');
INSERT INTO ui_strings (key, locale, value) VALUES ('docstatus.waiting', 'de', 'Wartet');
INSERT INTO ui_strings (key, locale, value) VALUES ('docstatus.moving', 'de', 'In Bearbeitung');
INSERT INTO ui_strings (key, locale, value) VALUES ('docstatus.done', 'de', 'Abgeschlossen');
INSERT INTO ui_strings (key, locale, value) VALUES ('docstatus.unreadable', 'de', 'Muss erfasst werden');
INSERT INTO ui_strings (key, locale, value) VALUES ('docstatus.outside', 'de', 'Nicht in einem Prozess');
INSERT INTO ui_strings (key, locale, value) VALUES ('doctype.380', 'de', 'Rechnung');
INSERT INTO ui_strings (key, locale, value) VALUES ('doctype.381', 'de', 'Gutschrift');
INSERT INTO ui_strings (key, locale, value) VALUES ('doctype.389', 'de', 'Gutschriftsverfahren');
INSERT INTO ui_strings (key, locale, value) VALUES ('doctype.unknown', 'de', 'Unbekannt');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE (key LIKE 'documents.%' OR key LIKE 'column.%' OR key LIKE 'docstatus.%' OR key LIKE 'doctype.%' OR key = 'nav.documents') == 66
