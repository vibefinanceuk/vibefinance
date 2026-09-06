-- 0022_validation_check_labels.sql
-- Decision 0119 — the validation checks, named for a person.
--
-- `total_missing` and `vat_arithmetic` are identifiers a rule tests
-- (decision 0044 named them deliberately, because "validation failed"
-- tells a rule author nothing). **They are not what somebody keying an
-- invoice should read** — the same problem `field.bt-129` had.
--
-- Each says what is wrong rather than which check fired, because the
-- person reading it is looking at the document and not at our code.
INSERT INTO ui_strings (key, locale, value) VALUES ('check.total_missing', 'en', 'No invoice total');
INSERT INTO ui_strings (key, locale, value) VALUES ('check.vat_arithmetic', 'en', 'Net plus VAT does not equal the total');
INSERT INTO ui_strings (key, locale, value) VALUES ('check.amount_due_mismatch', 'en', 'Amount due differs from the total');
INSERT INTO ui_strings (key, locale, value) VALUES ('check.date_order', 'en', 'Due date is before the issue date');
INSERT INTO ui_strings (key, locale, value) VALUES ('check.line_sum', 'en', 'Lines do not add up to the total');
INSERT INTO ui_strings (key, locale, value) VALUES ('check.code_list', 'en', 'Not a code the standard recognises');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.exceptions', 'en', 'Exceptions');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.noexceptions', 'en', 'Nothing to resolve.');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.online', 'en', 'line');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.notchecked', 'en', 'Not checked — the document does not carry the fields.');

INSERT INTO ui_strings (key, locale, value) VALUES ('check.total_missing', 'de', 'Kein Rechnungsbetrag');
INSERT INTO ui_strings (key, locale, value) VALUES ('check.vat_arithmetic', 'de', 'Netto plus Steuer ergibt nicht den Gesamtbetrag');
INSERT INTO ui_strings (key, locale, value) VALUES ('check.amount_due_mismatch', 'de', 'Zahlbetrag weicht vom Gesamtbetrag ab');
INSERT INTO ui_strings (key, locale, value) VALUES ('check.date_order', 'de', 'Fälligkeitsdatum liegt vor dem Rechnungsdatum');
INSERT INTO ui_strings (key, locale, value) VALUES ('check.line_sum', 'de', 'Positionen ergeben nicht den Gesamtbetrag');
INSERT INTO ui_strings (key, locale, value) VALUES ('check.code_list', 'de', 'Kein vom Standard anerkannter Code');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.exceptions', 'de', 'Ausnahmen');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.noexceptions', 'de', 'Nichts zu klären.');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.online', 'de', 'Position');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.notchecked', 'de', 'Nicht geprüft – die erforderlichen Felder fehlen.');

-- Point-in-time: every check has a label, in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'check.%' == 12
