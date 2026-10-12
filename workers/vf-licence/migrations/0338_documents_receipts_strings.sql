-- 0338_documents_receipts_strings.sql
-- Decision 0737 — goods receipts as rows of Documents: the Type filter, a receipt's type and states, and the PO column.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('doctype.goods_receipt', 'en', 'Goods receipt'),
 ('doctype.goods_receipt', 'de', 'Wareneingang'),
 ('docstatus.receipt_registered', 'en', 'Registered'),
 ('docstatus.receipt_registered', 'de', 'Erfasst'),
 ('docstatus.receipt_pending', 'en', 'Being checked'),
 ('docstatus.receipt_pending', 'de', 'In Prüfung'),
 ('docstatus.receipt_rejected', 'en', 'Rejected'),
 ('docstatus.receipt_rejected', 'de', 'Abgelehnt'),
 ('docstatus.receipt_returned', 'en', 'Goods returned'),
 ('docstatus.receipt_returned', 'de', 'Ware zurückgesandt'),
 ('docstatus.receipt_cancelled', 'en', 'Cancelled'),
 ('docstatus.receipt_cancelled', 'de', 'Storniert'),
 ('documents.type.label', 'en', 'Document type'),
 ('documents.type.label', 'de', 'Belegart'),
 ('documents.type.all', 'en', 'All types'),
 ('documents.type.all', 'de', 'Alle Belegarten'),
 ('documents.type.invoice', 'en', 'Invoices'),
 ('documents.type.invoice', 'de', 'Rechnungen'),
 ('documents.type.credit_note', 'en', 'Credit notes'),
 ('documents.type.credit_note', 'de', 'Gutschriften'),
 ('documents.type.goods_receipt', 'en', 'Goods receipts'),
 ('documents.type.goods_receipt', 'de', 'Wareneingänge'),
 ('column.po', 'en', 'PO'),
 ('column.po', 'de', 'Bestellung');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('doctype.goods_receipt', 'docstatus.receipt_registered', 'docstatus.receipt_pending', 'docstatus.receipt_rejected', 'docstatus.receipt_returned', 'docstatus.receipt_cancelled', 'documents.type.label', 'documents.type.all', 'documents.type.invoice', 'documents.type.credit_note', 'documents.type.goods_receipt', 'column.po') == 24
