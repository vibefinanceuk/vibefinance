-- 0289_po_receipts_strings.sql
-- Decision 0646 — Goods receipts, slice 4: receipts on the Purchase Orders
-- screen, and change orders that meet goods already received.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('purchaseorders.receipt', 'en', 'Receipt'),
 ('purchaseorders.receipt', 'de', 'Wareneingang'),
 ('purchaseorders.receiptall', 'en', 'Any receipt state'),
 ('purchaseorders.receiptall', 'de', 'Jeder Eingangsstand'),
 ('purchaseorders.receipts', 'en', 'Receipts and returns'),
 ('purchaseorders.receipts', 'de', 'Eingänge und Rücksendungen'),
 ('purchaseorders.receipts.none', 'en', 'Nothing received against this order yet.'),
 ('purchaseorders.receipts.none', 'de', 'Zu dieser Bestellung ist noch nichts eingegangen.'),
 ('purchaseorders.receipts.movement', 'en', '{date} · {number}: {kind} {qty} on line {line}'),
 ('purchaseorders.receipts.movement', 'de', '{date} · {number}: {kind} {qty} auf Position {line}'),
 ('purchaseorders.receipts.by', 'en', 'by {who}'),
 ('purchaseorders.receipts.by', 'de', 'von {who}'),
 ('purchaseorders.receiptwarnheading', 'en', 'Receipts to check'),
 ('purchaseorders.receiptwarnheading', 'de', 'Zu prüfende Wareneingänge'),
 ('purchaseorders.receiptwarn.line_removed', 'en', '{order} line {line} is no longer on the order, but {net} was received against it.'),
 ('purchaseorders.receiptwarn.line_removed', 'de', '{order} Position {line} ist nicht mehr in der Bestellung, aber {net} ist dazu eingegangen.'),
 ('purchaseorders.receiptwarn.below_received', 'en', '{order} line {line} now orders {ordered}, less than the {net} received. It shows over-received.'),
 ('purchaseorders.receiptwarn.below_received', 'de', '{order} Position {line} bestellt jetzt {ordered}, weniger als die eingegangenen {net}. Sie zeigt Mehreingang.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('purchaseorders.receipt', 'purchaseorders.receiptall', 'purchaseorders.receipts', 'purchaseorders.receipts.none', 'purchaseorders.receipts.movement', 'purchaseorders.receipts.by', 'purchaseorders.receiptwarnheading', 'purchaseorders.receiptwarn.line_removed', 'purchaseorders.receiptwarn.below_received') == 18
