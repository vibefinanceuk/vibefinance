-- 0138_supplier_performance_discount_eligibility_and_hold_history_strings.sql
--
-- Decision 0427 — Supplier Performance's own last two key metrics:
-- early-payment / discount eligibility (reported as eligibility, not
-- the design's own literal "capture rate" — this system has no
-- payment-execution data), and hold history (built on the new general
-- `supplier_field_changes` history, migration 0072). `supplierperformance.*`
-- already exists (migrations 0122, 0130, 0131, 0134); these are its
-- last new keys for this screen.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('supplierperformance.discounteligibility', 'en', 'Early-payment discount eligibility'),
 ('supplierperformance.discounteligibilitysub', 'en', 'Invoices currently inside their supplier''s own discount window, by currency'),
 ('supplierperformance.nodiscounteligibility', 'en', 'No invoices currently eligible for an early-payment discount'),
 ('supplierperformance.discounteligiblenote', 'en', '{n} invoices eligible at {pct}% within {days} days'),
 ('supplierperformance.holdhistory', 'en', 'Hold history'),
 ('supplierperformance.holdhistorysub', 'en', 'How often and for how long a supplier has been placed on hold, and why'),
 ('supplierperformance.noholdhistory', 'en', 'No recorded hold periods yet'),
 ('supplierperformance.holdstarted', 'en', 'Started'),
 ('supplierperformance.holdended', 'en', 'Ended'),
 ('supplierperformance.holdongoing', 'en', 'Ongoing'),
 ('supplierperformance.holdduration', 'en', 'Days on hold'),
 ('supplierperformance.holdreason', 'en', 'Reason');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('supplierperformance.discounteligibility', 'de', 'Skontofähigkeit bei vorzeitiger Zahlung'),
 ('supplierperformance.discounteligibilitysub', 'de', 'Rechnungen aktuell innerhalb des Skontofensters ihres Lieferanten, nach Währung'),
 ('supplierperformance.nodiscounteligibility', 'de', 'Derzeit keine Rechnungen für ein Skonto bei vorzeitiger Zahlung berechtigt'),
 ('supplierperformance.discounteligiblenote', 'de', '{n} Rechnungen berechtigt zu {pct}% innerhalb von {days} Tagen'),
 ('supplierperformance.holdhistory', 'de', 'Sperr-Historie'),
 ('supplierperformance.holdhistorysub', 'de', 'Wie oft und wie lange ein Lieferant gesperrt war, und warum'),
 ('supplierperformance.noholdhistory', 'de', 'Noch keine erfassten Sperrzeiträume'),
 ('supplierperformance.holdstarted', 'de', 'Beginn'),
 ('supplierperformance.holdended', 'de', 'Ende'),
 ('supplierperformance.holdongoing', 'de', 'Andauernd'),
 ('supplierperformance.holdduration', 'de', 'Tage gesperrt'),
 ('supplierperformance.holdreason', 'de', 'Grund');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('supplierperformance.discounteligibility','supplierperformance.discounteligibilitysub','supplierperformance.nodiscounteligibility','supplierperformance.discounteligiblenote','supplierperformance.holdhistory','supplierperformance.holdhistorysub','supplierperformance.noholdhistory','supplierperformance.holdstarted','supplierperformance.holdended','supplierperformance.holdongoing','supplierperformance.holdduration','supplierperformance.holdreason') == 24
