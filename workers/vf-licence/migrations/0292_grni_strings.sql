-- 0292_grni_strings.sql
-- Decision 0650 — goods received not invoiced: the card on AP Analytics' Financial
-- Performance tab.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('grni.heading', 'en', 'Goods received not invoiced'),
 ('grni.heading', 'de', 'Wareneingang ohne Rechnung'),
 ('grni.sub', 'en', 'In, not yet invoiced, at the purchase order''s price'),
 ('grni.sub', 'de', 'Eingegangen, noch nicht berechnet, zum Bestellpreis'),
 ('grni.asat', 'en', 'As at'),
 ('grni.asat', 'de', 'Stichtag'),
 ('grni.download', 'en', 'Download CSV'),
 ('grni.download', 'de', 'CSV herunterladen'),
 ('grni.lines', 'en', 'Order lines: {n}'),
 ('grni.lines', 'de', 'Bestellpositionen: {n}'),
 ('grni.over60', 'en', '{amount} over 60 days'),
 ('grni.over60', 'de', '{amount} älter als 60 Tage'),
 ('grni.unpriced', 'en', 'Lines with no price on the order: {n}'),
 ('grni.unpriced', 'de', 'Positionen ohne Preis in der Bestellung: {n}'),
 ('grni.none', 'en', 'Nothing received and not yet invoiced at this date.'),
 ('grni.none', 'de', 'Zu diesem Stichtag ist nichts eingegangen und unberechnet.'),
 ('grni.nosupplier', 'en', 'Supplier not on file'),
 ('grni.nosupplier', 'de', 'Lieferant nicht hinterlegt'),
 ('grni.col.supplier', 'en', 'Supplier'),
 ('grni.col.supplier', 'de', 'Lieferant'),
 ('grni.col.orders', 'en', 'Orders'),
 ('grni.col.orders', 'de', 'Bestellungen'),
 ('grni.col.d30', 'en', '0–30 days'),
 ('grni.col.d30', 'de', '0–30 Tage'),
 ('grni.col.d60', 'en', '31–60'),
 ('grni.col.d60', 'de', '31–60'),
 ('grni.col.over60', 'en', 'Over 60'),
 ('grni.col.over60', 'de', 'Über 60'),
 ('grni.col.total', 'en', 'Total'),
 ('grni.col.total', 'de', 'Summe');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('grni.heading', 'grni.sub', 'grni.asat', 'grni.download', 'grni.lines', 'grni.over60', 'grni.unpriced', 'grni.none', 'grni.nosupplier', 'grni.col.supplier', 'grni.col.orders', 'grni.col.d30', 'grni.col.d60', 'grni.col.over60', 'grni.col.total') == 30
