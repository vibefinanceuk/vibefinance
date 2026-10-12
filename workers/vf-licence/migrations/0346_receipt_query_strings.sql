-- 0346_receipt_query_strings.sql
-- Decision 0748 — Ask supplier on a goods receipt, and the supplier's messages in Conversations.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('receipts.asksupplier.note', 'en', 'The receipt stays as it is. {supplier} sees the receipt as Query raised until they answer.'),
 ('receipts.asksupplier.note', 'de', 'Der Wareneingang bleibt unverändert. {supplier} sieht den Wareneingang als Rückfrage, bis er antwortet.'),
 ('receipts.conv.tag.supplier', 'en', 'From the supplier'),
 ('receipts.conv.tag.supplier', 'de', 'Vom Lieferanten');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('receipts.asksupplier.note', 'receipts.conv.tag.supplier') == 4
