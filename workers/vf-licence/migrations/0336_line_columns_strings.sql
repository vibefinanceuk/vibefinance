-- 0336_line_columns_strings.sql
-- Decision 0734 — choosing the invoice line columns in the viewer.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.lines.choosecolumns', 'en', 'Choose the line columns'),
 ('viewer.lines.choosecolumns', 'de', 'Positionsspalten wählen'),
 ('viewer.lines.fromdocument', 'en', 'From the document'),
 ('viewer.lines.fromdocument', 'de', 'Aus dem Beleg'),
 ('viewer.lines.matching', 'en', 'Matching'),
 ('viewer.lines.matching', 'de', 'Abgleich'),
 ('viewer.lines.workedout', 'en', 'worked out'),
 ('viewer.lines.workedout', 'de', 'berechnet'),
 ('viewer.lines.remembered', 'en', 'Remembered for you, in this browser'),
 ('viewer.lines.remembered', 'de', 'Für Sie gespeichert, in diesem Browser'),
 ('viewer.lines.reset', 'en', 'Reset to standard'),
 ('viewer.lines.reset', 'de', 'Auf Standard zurücksetzen'),
 ('viewer.lines.yes', 'en', 'Yes'),
 ('viewer.lines.yes', 'de', 'Ja'),
 ('viewer.lines.no', 'en', 'No'),
 ('viewer.lines.no', 'de', 'Nein'),
 ('viewer.lines.col.linetotal', 'en', 'Line total with VAT'),
 ('viewer.lines.col.linetotal', 'de', 'Positionssumme inkl. USt.'),
 ('viewer.lines.col.found', 'en', 'PO line found'),
 ('viewer.lines.col.found', 'de', 'Bestellposition gefunden'),
 ('viewer.lines.col.price', 'en', 'Price matched'),
 ('viewer.lines.col.price', 'de', 'Preis passt'),
 ('viewer.lines.col.pricepct', 'en', 'Price variance %'),
 ('viewer.lines.col.pricepct', 'de', 'Preisabweichung %'),
 ('viewer.lines.col.qty', 'en', 'Quantity matched'),
 ('viewer.lines.col.qty', 'de', 'Menge passt'),
 ('viewer.lines.col.qtypct', 'en', 'Quantity variance %'),
 ('viewer.lines.col.qtypct', 'de', 'Mengenabweichung %'),
 ('viewer.lines.col.unit', 'en', 'Unit matches'),
 ('viewer.lines.col.unit', 'de', 'Einheit passt'),
 ('viewer.lines.col.nonpo', 'en', 'Non-PO line'),
 ('viewer.lines.col.nonpo', 'de', 'Position ohne Bestellung');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'viewer.lines.%' AND key IN ('viewer.lines.choosecolumns', 'viewer.lines.fromdocument', 'viewer.lines.matching', 'viewer.lines.workedout', 'viewer.lines.remembered', 'viewer.lines.reset', 'viewer.lines.yes', 'viewer.lines.no', 'viewer.lines.col.linetotal', 'viewer.lines.col.found', 'viewer.lines.col.price', 'viewer.lines.col.pricepct', 'viewer.lines.col.qty', 'viewer.lines.col.qtypct', 'viewer.lines.col.unit', 'viewer.lines.col.nonpo') == 32
