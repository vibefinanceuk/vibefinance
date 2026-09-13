-- 0087_payment_terms_field.sql
-- Decision 0296 — BT-20, payment terms, added to the invoice
-- vocabulary at the real customer's own asking, to replace the Cost
-- centre slot on the Invoice header card (which never belonged there
-- — BT-133 is a line field, not a header one).
INSERT INTO ui_strings (key, locale, value) VALUES
  ('field.bt-20', 'en', 'Payment terms'),
  ('field.bt-20', 'de', 'Zahlungsbedingungen');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'field.bt-20' == 2
