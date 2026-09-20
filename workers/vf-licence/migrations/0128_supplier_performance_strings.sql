-- 0128_supplier_performance_strings.sql
--
-- Decision 0416 — the Supplier Performance screen, the second real
-- route and UI drawn from the Management Dashboard design (decision
-- 0415 built the first, Workload). "Spend by supplier, with a top-N
-- ranking" — the design's own second bullet under Supplier
-- Performance's key metrics, gated on `AP.Supplier` and scoped exactly
-- the way the existing Suppliers screen already is.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('nav.supplierperformance', 'en', 'Performance'),
 ('supplierperformance.heading', 'en', 'Supplier Performance'),
 ('supplierperformance.sub', 'en', 'How the supplier base is doing'),
 ('supplierperformance.spend', 'en', 'Spend by supplier'),
 ('supplierperformance.spendsub', 'en', 'Ranked by total invoiced amount, by currency'),
 ('supplierperformance.nospend', 'en', 'No priced invoices yet'),
 ('supplierperformance.invoicecount', 'en', '{n} invoices');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('nav.supplierperformance', 'de', 'Leistung'),
 ('supplierperformance.heading', 'de', 'Lieferantenleistung'),
 ('supplierperformance.sub', 'de', 'Wie der Lieferantenstamm abschneidet'),
 ('supplierperformance.spend', 'de', 'Ausgaben nach Lieferant'),
 ('supplierperformance.spendsub', 'de', 'Nach Gesamtrechnungsbetrag geordnet, je Währung'),
 ('supplierperformance.nospend', 'de', 'Noch keine bepreisten Rechnungen'),
 ('supplierperformance.invoicecount', 'de', '{n} Rechnungen');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('nav.supplierperformance','supplierperformance.heading','supplierperformance.sub','supplierperformance.spend','supplierperformance.spendsub','supplierperformance.nospend','supplierperformance.invoicecount') == 14
