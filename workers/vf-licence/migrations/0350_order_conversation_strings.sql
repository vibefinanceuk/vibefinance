-- 0350_order_conversation_strings.sql
-- Decision 0752 — the conversation with a supplier about a purchase order.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('purchaseorders.supplierchat', 'en', 'The conversation with the supplier'),
 ('purchaseorders.supplierchat', 'de', 'Unterhaltung mit dem Lieferanten'),
 ('purchaseorders.asksupplier.note', 'en', 'The order stays as it is. {supplier} sees the order as Query raised until they answer.'),
 ('purchaseorders.asksupplier.note', 'de', 'Die Bestellung bleibt unverändert. {supplier} sieht die Bestellung als Rückfrage, bis er antwortet.'),
 ('purchaseorders.conv.order', 'en', 'Purchase order {number}'),
 ('purchaseorders.conv.order', 'de', 'Bestellung {number}');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('purchaseorders.supplierchat', 'purchaseorders.asksupplier.note', 'purchaseorders.conv.order') == 6
