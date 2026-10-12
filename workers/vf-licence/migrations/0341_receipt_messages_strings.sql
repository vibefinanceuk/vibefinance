-- 0341_receipt_messages_strings.sql
-- Decision 0740 — a goods receipt's conversation with the customer, in the network: the line above it says where to ask.

UPDATE ui_strings SET value = 'As {customer} recorded it against your purchase orders. A question about this delivery: write to {customer} here.' WHERE key = 'network.receipt.note' AND locale = 'en';
UPDATE ui_strings SET value = 'So wie {customer} ihn zu Ihren Bestellungen erfasst hat. Eine Frage zu dieser Lieferung: Schreiben Sie {customer} hier.' WHERE key = 'network.receipt.note' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'network.receipt.note' AND value LIKE '%here.' == 1
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'network.receipt.note' AND value LIKE '%hier.' == 1
