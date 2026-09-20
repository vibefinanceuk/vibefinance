-- 0132_fraud_prevention_duplicates_strings.sql
--
-- Decision 0420 — the Fraud Prevention tab's first real metric,
-- "Potential duplicate invoices — same supplier, same amount,
-- same/near invoice date" (the design's own first bullet under
-- Screen 3 — Fraud & Risk Detection's key metrics), gated on
-- `AP.FraudReview`.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('fraudprevention.duplicates', 'en', 'Potential duplicate invoices'),
 ('fraudprevention.duplicatessub', 'en', 'Same supplier, amount and date — sorted by confidence'),
 ('fraudprevention.noduplicates', 'en', 'No potential duplicates right now'),
 ('fraudprevention.invoicenumber', 'en', 'Invoice'),
 ('fraudprevention.supplier', 'en', 'Supplier'),
 ('fraudprevention.amount', 'en', 'Amount'),
 ('fraudprevention.issuedate', 'en', 'Issue date'),
 ('fraudprevention.confidence', 'en', 'Confidence');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('fraudprevention.duplicates', 'de', 'Mögliche doppelte Rechnungen'),
 ('fraudprevention.duplicatessub', 'de', 'Gleicher Lieferant, Betrag und Datum — sortiert nach Konfidenz'),
 ('fraudprevention.noduplicates', 'de', 'Derzeit keine möglichen Duplikate'),
 ('fraudprevention.invoicenumber', 'de', 'Rechnung'),
 ('fraudprevention.supplier', 'de', 'Lieferant'),
 ('fraudprevention.amount', 'de', 'Betrag'),
 ('fraudprevention.issuedate', 'de', 'Rechnungsdatum'),
 ('fraudprevention.confidence', 'de', 'Konfidenz');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('fraudprevention.duplicates','fraudprevention.duplicatessub','fraudprevention.noduplicates','fraudprevention.invoicenumber','fraudprevention.supplier','fraudprevention.amount','fraudprevention.issuedate','fraudprevention.confidence') == 16
