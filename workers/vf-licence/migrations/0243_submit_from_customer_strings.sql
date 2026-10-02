-- 0243_submit_from_customer_strings.sql
-- Decision 0596. A partner's people may submit a connector from a customer
-- the partner serves, as well as from the partner's sandbox.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('submit.from.customer', 'en', 'You are working in {customer}''s environment, a customer {partner} serves. VibeFinance will see that this version was built here.'),
 ('submit.from.customer', 'de', 'Sie arbeiten in der Umgebung von {customer}, einem Kunden von {partner}. VibeFinance sieht, dass diese Version hier erstellt wurde.'),
 ('httpsout.error.not_partner_environment', 'en', 'Only the people of a partner serving this customer can submit connectors here.'),
 ('httpsout.error.not_partner_environment', 'de', 'Nur Personen eines Partners, der diesen Kunden betreut, können hier Connectoren einreichen.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('submit.from.customer','httpsout.error.not_partner_environment') == 4
