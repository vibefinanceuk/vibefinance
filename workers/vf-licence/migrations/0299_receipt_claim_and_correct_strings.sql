-- 0299_receipt_claim_and_correct_strings.sql
-- Decision 0657 — claim a receipt task before acting on it, and correct a
-- line's unit and quantity.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('receipts.task.mine', 'en', 'You have claimed this receipt''s task. Fix its lines, then Register or Reject.'),
 ('receipts.task.mine', 'de', 'Sie haben die Aufgabe zu diesem Eingang übernommen. Korrigieren Sie die Positionen, dann Erfassen oder Ablehnen.'),
 ('receipts.task.other', 'en', '{who} has claimed this receipt''s task. Only they can work on it.'),
 ('receipts.task.other', 'de', '{who} hat die Aufgabe zu diesem Eingang übernommen. Nur diese Person kann ihn bearbeiten.'),
 ('receipts.task.none', 'en', 'Nobody has claimed this receipt''s task. Claim it to fix lines, register or reject.'),
 ('receipts.task.none', 'de', 'Niemand hat die Aufgabe zu diesem Eingang übernommen. Übernehmen Sie sie, um Positionen zu korrigieren, zu erfassen oder abzulehnen.'),
 ('receipts.task.claim', 'en', 'Claim'),
 ('receipts.task.claim', 'de', 'Übernehmen'),
 ('receipts.task.release', 'en', 'Release'),
 ('receipts.task.release', 'de', 'Freigeben'),
 ('receipts.task.failed', 'en', 'The task could not be changed.'),
 ('receipts.task.failed', 'de', 'Die Aufgabe konnte nicht geändert werden.'),
 ('receipts.fix.quantity', 'en', 'Quantity'),
 ('receipts.fix.quantity', 'de', 'Menge'),
 ('receipts.fix.unit', 'en', 'Unit'),
 ('receipts.fix.unit', 'de', 'Einheit'),
 ('receipts.orderline', 'en', '{item} · ordered {qty} {unit}'),
 ('receipts.orderline', 'de', '{item} · bestellt {qty} {unit}'),
 ('receipts.orderline.missing', 'en', 'Not a line on this order'),
 ('receipts.orderline.missing', 'de', 'Keine Position dieser Bestellung'),
 ('receipts.corrected', 'en', 'Was {was}, corrected by {who}'),
 ('receipts.corrected', 'de', 'War {was}, korrigiert von {who}'),
 ('receipts.error.task_not_claimed', 'en', 'Claim the receipt''s task before acting on it.'),
 ('receipts.error.task_not_claimed', 'de', 'Übernehmen Sie die Aufgabe zum Eingang, bevor Sie ihn bearbeiten.'),
 ('receipts.error.task_claimed_by_other', 'en', 'Someone else has claimed this receipt''s task.'),
 ('receipts.error.task_claimed_by_other', 'de', 'Jemand anderes hat die Aufgabe zu diesem Eingang übernommen.'),
 ('receipts.error.task_not_yours', 'en', 'This receipt''s task is assigned to someone else.'),
 ('receipts.error.task_not_yours', 'de', 'Die Aufgabe zu diesem Eingang ist jemand anderem zugewiesen.'),
 ('receipts.error.unit_invalid', 'en', 'The unit must be a short code, such as EA.'),
 ('receipts.error.unit_invalid', 'de', 'Die Einheit muss ein kurzer Code sein, etwa EA.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('receipts.task.mine', 'receipts.task.other', 'receipts.task.none', 'receipts.task.claim', 'receipts.task.release', 'receipts.task.failed', 'receipts.fix.quantity', 'receipts.fix.unit', 'receipts.orderline', 'receipts.orderline.missing', 'receipts.corrected', 'receipts.error.task_not_claimed', 'receipts.error.task_claimed_by_other', 'receipts.error.task_not_yours', 'receipts.error.unit_invalid') == 30
