-- 0342_create_cards_strings.sql
-- Decision 0743 — Create's ways as cards: what each is for, in a line.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('create.ways', 'en', 'How to bring it in'),
 ('create.ways', 'de', 'Wie Sie es erfassen'),
 ('create.keyed.help', 'en', 'Key an invoice on screen, header and lines, for a supplier who sends paper or nothing you can upload.'),
 ('create.keyed.help', 'de', 'Eine Rechnung am Bildschirm erfassen, Kopf und Positionen, für einen Lieferanten, der Papier oder nichts Hochladbares schickt.'),
 ('create.upload.help', 'en', 'Drop a PDF or a photo of an invoice. It is read for you and goes through the process like one that came by email.'),
 ('create.upload.help', 'de', 'Ein PDF oder Foto einer Rechnung ablegen. Sie wird für Sie gelesen und durchläuft den Prozess wie eine per E-Mail eingegangene.'),
 ('create.batch.help', 'en', 'Many invoices at once from one file. Previewed line by line before anything is sent.'),
 ('create.batch.help', 'de', 'Viele Rechnungen auf einmal aus einer Datei. Zeile für Zeile in der Vorschau, bevor etwas gesendet wird.'),
 ('create.gr.upload.help', 'en', 'A warehouse export of receipts and returns. Previewed before it is sent, and through Warehouse Receipts when that is set up.'),
 ('create.gr.upload.help', 'de', 'Ein Lagerexport von Wareneingängen und Rücksendungen. Vor dem Senden in der Vorschau, und über Wareneingänge im Lager, wenn eingerichtet.'),
 ('create.gr.keyreceipt.help', 'en', 'What arrived, against a purchase order''s lines. Checked as it is typed and registered at once.'),
 ('create.gr.keyreceipt.help', 'de', 'Was angekommen ist, zu den Positionen einer Bestellung. Bei der Eingabe geprüft und sofort erfasst.'),
 ('create.gr.keyreturn.help', 'en', 'What went back to the supplier, against the order''s lines, and why.'),
 ('create.gr.keyreturn.help', 'de', 'Was an den Lieferanten zurückging, zu den Positionen der Bestellung, und warum.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('create.ways', 'create.keyed.help', 'create.upload.help', 'create.batch.help', 'create.gr.upload.help', 'create.gr.keyreceipt.help', 'create.gr.keyreturn.help') == 14
