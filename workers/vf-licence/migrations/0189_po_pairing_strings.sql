-- 0189_po_pairing_strings.sql
-- Decision 0532. The PO matching panel, phase 2: the per-line PO line
-- picker, who paired a line, and the Timeline lines a pairing records.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('pomatch.pair.own', 'en', 'The invoice''s own reference (line {ref})'),
 ('pomatch.pair.choose', 'en', 'Choose a PO line…'),
 ('pomatch.pair.option', 'en', 'Line {n}: {name}'),
 ('pomatch.pair.label', 'en', 'PO line for invoice line {n}'),
 ('pomatch.pairedby', 'en', 'Paired by {who}'),
 ('pomatch.supplierref', 'en', 'the invoice says line {ref}'),
 ('pomatch.pairfailed', 'en', 'The pairing could not be saved.'),
 ('activity.popaired', 'en', '{who} paired invoice line {line} with PO line {poline}'),
 ('activity.pocleared', 'en', '{who} cleared the pairing for invoice line {line}');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('pomatch.pair.own', 'de', 'Eigene Referenz der Rechnung (Position {ref})'),
 ('pomatch.pair.choose', 'de', 'Bestellposition wählen…'),
 ('pomatch.pair.option', 'de', 'Position {n}: {name}'),
 ('pomatch.pair.label', 'de', 'Bestellposition für Rechnungsposition {n}'),
 ('pomatch.pairedby', 'de', 'Zugeordnet von {who}'),
 ('pomatch.supplierref', 'de', 'die Rechnung nennt Position {ref}'),
 ('pomatch.pairfailed', 'de', 'Die Zuordnung konnte nicht gespeichert werden.'),
 ('activity.popaired', 'de', '{who} hat Rechnungsposition {line} der Bestellposition {poline} zugeordnet'),
 ('activity.pocleared', 'de', '{who} hat die Zuordnung für Rechnungsposition {line} aufgehoben');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('pomatch.pair.own', 'pomatch.pair.choose', 'pomatch.pair.option', 'pomatch.pair.label', 'pomatch.pairedby', 'pomatch.supplierref', 'pomatch.pairfailed', 'activity.popaired', 'activity.pocleared') == 18
