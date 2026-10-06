-- 0296_receipts_waiting_strings.sql
-- Decision 0654 — Warehouse Receipts, slice 4: receipt lines waiting
-- for their purchase order.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('receipts.error.order_not_loaded', 'en', 'Its purchase order is not loaded yet: the line waits for it.'),
 ('receipts.error.order_not_loaded', 'de', 'Die Bestellung ist noch nicht geladen: Die Position wartet darauf.'),
 ('receipts.error.all_waiting', 'en', 'Every line still waits for its purchase order: there is nothing to register yet.'),
 ('receipts.error.all_waiting', 'de', 'Alle Positionen warten noch auf ihre Bestellung: Es gibt noch nichts zu erfassen.'),
 ('receipts.waiting.line', 'en', 'Waiting for its PO · days: {days}'),
 ('receipts.waiting.line', 'de', 'Wartet auf Bestellung · Tage: {days}'),
 ('receipts.waiting.receipt', 'en', 'Lines waiting for a PO: {n} · days: {days}'),
 ('receipts.waiting.receipt', 'de', 'Auf Bestellung wartende Positionen: {n} · Tage: {days}'),
 ('receipts.waiting.long', 'en', 'Waiting more than 7 days'),
 ('receipts.waiting.long', 'de', 'Wartet länger als 7 Tage'),
 ('receipts.kind.waiting', 'en', 'Waiting for a PO'),
 ('receipts.kind.waiting', 'de', 'Wartet auf Bestellung'),
 ('receipts.check.counted', 'en', 'Counted'),
 ('receipts.check.counted', 'de', 'Gezählt'),
 ('receipts.heldback', 'en', 'Registered. Lines held back waiting for their purchase order: {n}. Each counts once its order is loaded and it matches.'),
 ('receipts.heldback', 'de', 'Erfasst. Zurückgehaltene Positionen, die auf ihre Bestellung warten: {n}. Jede zählt, sobald ihre Bestellung geladen ist und sie passt.'),
 ('purchaseorders.waitingreceipts', 'en', 'Goods receipts waiting for these orders. Registered: {registered}. Lines now counted: {lines}. Still waiting or needing attention: {still}.'),
 ('purchaseorders.waitingreceipts', 'de', 'Wareneingänge, die auf diese Bestellungen warteten. Erfasst: {registered}. Jetzt gezählte Positionen: {lines}. Wartend oder zu prüfen: {still}.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('receipts.error.order_not_loaded', 'receipts.error.all_waiting', 'receipts.waiting.line', 'receipts.waiting.receipt', 'receipts.waiting.long', 'receipts.kind.waiting', 'receipts.check.counted', 'receipts.heldback', 'purchaseorders.waitingreceipts') == 18
