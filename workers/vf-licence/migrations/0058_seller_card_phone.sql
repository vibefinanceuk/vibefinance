-- 0058_seller_card_phone.sql
-- Decision 0221 — a number to ring, and shorter labels.
--
-- **The operator's own mock-up used short forms**: *VAT No*,
-- *E-Address*, *E-Mail*. On a card of five inline labels, *Electronic
-- address* is wider than most of the values beside it.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.supplier.phone', 'en', 'Phone'),
 ('viewer.supplier.phone', 'de', 'Telefon');

UPDATE ui_strings SET value = 'VAT no' WHERE key = 'viewer.supplier.vat' AND locale = 'en';
UPDATE ui_strings SET value = 'E-address' WHERE key = 'viewer.supplier.endpoint' AND locale = 'en';
UPDATE ui_strings SET value = 'E-mail' WHERE key = 'viewer.supplier.email' AND locale = 'en';

UPDATE ui_strings SET value = 'USt-IdNr.' WHERE key = 'viewer.supplier.vat' AND locale = 'de';
UPDATE ui_strings SET value = 'E-Adresse' WHERE key = 'viewer.supplier.endpoint' AND locale = 'de';
UPDATE ui_strings SET value = 'E-Mail' WHERE key = 'viewer.supplier.email' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'viewer.supplier.phone' == 2
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'viewer.supplier.endpoint' AND value = 'Electronic address' == 0
