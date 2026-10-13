-- 0364_receipt_document_strings.sql
-- Decision 0773 — a goods receipt as a PDF, with its Document tab, in VibeFinance and in the supplier network.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('receiptdoc.title', 'en', 'Goods receipt {receipt}'),
 ('receiptdoc.title', 'de', 'Wareneingang {receipt}'),
 ('receiptdoc.attachhead', 'en', 'The receipt as the supplier sees it'),
 ('receiptdoc.attachhead', 'de', 'Der Wareneingang, wie der Lieferant ihn sieht'),
 ('network.receipt.attachhead', 'en', 'As {customer} recorded it'),
 ('network.receipt.attachhead', 'de', 'Wie {customer} ihn erfasst hat');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('receiptdoc.title', 'receiptdoc.attachhead', 'network.receipt.attachhead') == 6
