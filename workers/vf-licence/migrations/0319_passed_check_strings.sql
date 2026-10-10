-- 0319_passed_check_strings.sql
-- Decision 0710 — hovering a field a check passed showed that check's failure
-- wording ("Due date is before the issue date" on a due date that was fine).
-- A passed check now says what passed.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('check.ok', 'en', 'Checked'),
 ('check.ok', 'de', 'Geprüft'),
 ('check.vat_arithmetic.ok', 'en', 'Net plus VAT equals the total'),
 ('check.vat_arithmetic.ok', 'de', 'Netto plus MwSt. ergibt den Gesamtbetrag'),
 ('check.amount_due_mismatch.ok', 'en', 'Amount due agrees with the total'),
 ('check.amount_due_mismatch.ok', 'de', 'Zahlbetrag stimmt mit dem Gesamtbetrag überein'),
 ('check.date_order.ok', 'en', 'Due date is on or after the issue date'),
 ('check.date_order.ok', 'de', 'Fälligkeitsdatum liegt am oder nach dem Rechnungsdatum'),
 ('check.line_sum.ok', 'en', 'Lines add up to the total'),
 ('check.line_sum.ok', 'de', 'Positionen ergeben den Gesamtbetrag'),
 ('check.po_mismatch.ok', 'en', 'Matches the purchase order'),
 ('check.po_mismatch.ok', 'de', 'Stimmt mit der Bestellung überein'),
 ('check.code_list.ok', 'en', 'A code the standard recognises'),
 ('check.code_list.ok', 'de', 'Ein Code, den der Standard kennt');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'check.ok' OR key LIKE 'check.%.ok' == 14
