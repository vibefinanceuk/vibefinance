-- 0297_receipts_in_strings.sql
-- Decision 0655 — Warehouse Receipts, slice 5: receipts arrive by a
-- route.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('receipts.status.registered', 'en', 'Registered'),
 ('receipts.status.registered', 'de', 'Erfasst'),
 ('routemonitor.made.receipts', 'en', 'Goods receipts: {n}'),
 ('routemonitor.made.receipts', 'de', 'Wareneingänge: {n}'),
 ('routemonitor.made.receiptswaiting', 'en', 'waiting: {n}'),
 ('routemonitor.made.receiptswaiting', 'de', 'wartend: {n}'),
 ('routemonitor.receipts', 'en', 'Goods receipts'),
 ('routemonitor.receipts', 'de', 'Wareneingänge'),
 ('receiptsin.howtohint', 'en', 'Send JSON as shown, or our receipt CSV as text/csv. The answer says what each receipt became. Ask again at its check address.'),
 ('receiptsin.howtohint', 'de', 'Senden Sie JSON wie gezeigt oder unsere Wareneingangs-CSV als text/csv. Die Antwort nennt, was aus jedem Wareneingang wurde. Fragen Sie später unter seiner Prüfadresse nach.'),
 ('create.gr.message', 'en', 'Route monitor message: {id}'),
 ('create.gr.message', 'de', 'Nachricht im Routen-Monitor: {id}'),
 ('routemonitor.cannot.receipts_resend', 'en', 'Goods receipts are not run again here: send them again. Receipts and lines already loaded are skipped.'),
 ('routemonitor.cannot.receipts_resend', 'de', 'Wareneingänge werden hier nicht erneut verarbeitet: Senden Sie sie erneut. Bereits geladene Wareneingänge und Positionen werden übersprungen.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('receipts.status.registered', 'routemonitor.made.receipts', 'routemonitor.made.receiptswaiting', 'routemonitor.receipts', 'receiptsin.howtohint', 'create.gr.message') == 12

-- 0651's note on a goods receipt process said receipts came from Goods
-- Receipts only; now they come by routes too.
UPDATE ui_strings SET value = 'Goods receipts reach this process from Create and from warehouse systems by Receipts in. It has no destinations: Complete registers each receipt.' WHERE key = 'processroutes.subject.goods_receipt.note' AND locale = 'en';
UPDATE ui_strings SET value = 'Wareneingänge erreichen diesen Prozess über Erstellen und von Lagersystemen über Receipts in. Er hat keine Ziele: Abgeschlossen erfasst jeden Wareneingang.' WHERE key = 'processroutes.subject.goods_receipt.note' AND locale = 'de';
