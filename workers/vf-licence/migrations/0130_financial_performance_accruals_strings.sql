-- 0130_financial_performance_accruals_strings.sql
--
-- Decision 0417's own follow-on — the Financial Performance tab's
-- first real metric, "Accruals report: invoices received but not yet
-- at the payment-eligible stage" (the design's own first bullet under
-- Liabilities & Accruals' key metrics), gated on `AP.Analysis` like
-- the rest of the tab.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('financialperformance.accruals', 'en', 'Accruals report'),
 ('financialperformance.accrualssub', 'en', 'Received, not yet payment-eligible, by stage'),
 ('financialperformance.noaccruals', 'en', 'No open liabilities right now'),
 ('financialperformance.accrued', 'en', '{amount} accrued'),
 ('financialperformance.invoicecount', 'en', '{n} invoices');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('financialperformance.accruals', 'de', 'Rückstellungsbericht'),
 ('financialperformance.accrualssub', 'de', 'Erhalten, noch nicht zahlungsbereit, nach Phase'),
 ('financialperformance.noaccruals', 'de', 'Derzeit keine offenen Verbindlichkeiten'),
 ('financialperformance.accrued', 'de', '{amount} zurückgestellt'),
 ('financialperformance.invoicecount', 'de', '{n} Rechnungen');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('financialperformance.accruals','financialperformance.accrualssub','financialperformance.noaccruals','financialperformance.accrued','financialperformance.invoicecount') == 10
