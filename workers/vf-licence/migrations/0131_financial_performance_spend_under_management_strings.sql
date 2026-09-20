-- 0131_financial_performance_spend_under_management_strings.sql
--
-- Decision 0419 — the Financial Performance tab's second real metric,
-- "Spend under management (with PO) vs. total spend" (the design's
-- own fifth bullet under Liabilities & Accruals' key metrics), gated
-- on `AP.Analysis` like the rest of the tab.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('financialperformance.spendundermanagement', 'en', 'Spend under management'),
 ('financialperformance.spendundermanagementsub', 'en', 'Share of spend backed by a purchase order'),
 ('financialperformance.nospend', 'en', 'No spend recorded yet'),
 ('financialperformance.totalspend', 'en', '{amount} total spend'),
 ('financialperformance.withpospend', 'en', '{amount} with a PO'),
 ('financialperformance.invoiceswithpo', 'en', '{withpo} of {total} invoices with a PO');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('financialperformance.spendundermanagement', 'de', 'Verwaltete Ausgaben'),
 ('financialperformance.spendundermanagementsub', 'de', 'Anteil der Ausgaben mit Bestellbezug'),
 ('financialperformance.nospend', 'de', 'Noch keine Ausgaben erfasst'),
 ('financialperformance.totalspend', 'de', '{amount} Gesamtausgaben'),
 ('financialperformance.withpospend', 'de', '{amount} mit Bestellung'),
 ('financialperformance.invoiceswithpo', 'de', '{withpo} von {total} Rechnungen mit Bestellung');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('financialperformance.spendundermanagement','financialperformance.spendundermanagementsub','financialperformance.nospend','financialperformance.totalspend','financialperformance.withpospend','financialperformance.invoiceswithpo') == 12
