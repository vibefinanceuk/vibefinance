-- 0291_receipt_recheck_strings.sql
-- Decision 0648 — the re-check when goods arrive: the Timeline line for a
-- task that closed by itself, and what the Goods Receipts screen says.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('activity.receiptclosed', 'en', '{rule} no longer applies after {receipt}, recorded by {who}. Its task closed by itself.'),
 ('activity.receiptclosed', 'de', '{rule} gilt nach {receipt}, erfasst von {who}, nicht mehr. Die Aufgabe hat sich von selbst geschlossen.'),
 ('receipts.recheck.closed', 'en', 'Invoice tasks waiting on these goods that have now closed: {n}.'),
 ('receipts.recheck.closed', 'de', 'Rechnungsaufgaben, die auf diese Ware warteten und sich jetzt geschlossen haben: {n}.'),
 ('receipts.recheck.open', 'en', 'Invoice tasks still waiting, as more is invoiced than is in: {n}.'),
 ('receipts.recheck.open', 'de', 'Rechnungsaufgaben, die weiter warten, weil mehr berechnet als eingegangen ist: {n}.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('activity.receiptclosed', 'receipts.recheck.closed', 'receipts.recheck.open') == 6
