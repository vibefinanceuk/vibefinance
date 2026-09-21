-- 0142_executive_iq_remaining_four_metrics_strings.sql
--
-- Decision 0431 — the Multi-Enterprise CFO View's remaining four
-- data-buildable metrics: liabilities and accruals by entity,
-- cross-entity supplier concentration, cross-entity exception and
-- fraud-signal trend, and cross-org throughput/workload comparison.
-- Gated on `AP.Analysis` and `holdsEverywhere`, the same as decision
-- 0425's own consolidated spend. Reuses `executiveiq.legalentity` /
-- `executiveiq.operatingunit` (migration 0137),
-- `financialperformance.invoicecount` (migration 0130), and
-- `fraudprevention.exceptioncount` / `fraudprevention.trend`
-- (migration 0134) rather than duplicating any of them.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('executiveiq.liabilitiesbyentity', 'en', 'Liabilities and accruals by entity'),
 ('executiveiq.liabilitiesbyentitysub', 'en', 'Every entity, by currency'),
 ('executiveiq.noliabilitiesbyentity', 'en', 'No accruing invoices yet'),
 ('executiveiq.supplierconcentration', 'en', 'Cross-entity supplier concentration'),
 ('executiveiq.supplierconcentrationsub', 'en', 'Suppliers ranking as a top-5 vendor in 2 or more entities'),
 ('executiveiq.nosupplierconcentration', 'en', 'No supplier ranks as a top vendor in more than one entity'),
 ('executiveiq.supplier', 'en', 'Supplier'),
 ('executiveiq.entitycount', 'en', 'Entities'),
 ('executiveiq.entities', 'en', 'Appears as a top vendor in'),
 ('executiveiq.exceptiontrendsbyentity', 'en', 'Cross-entity exception and fraud-signal trend'),
 ('executiveiq.exceptiontrendsbyentitysub', 'en', 'Every entity, trended over 8 weeks'),
 ('executiveiq.noexceptiontrendsbyentity', 'en', 'No exceptions in the last 8 weeks'),
 ('executiveiq.entity', 'en', 'Entity'),
 ('executiveiq.throughputbyentity', 'en', 'Cross-org throughput/workload comparison'),
 ('executiveiq.throughputbyentitysub', 'en', 'Tasks completed in the last 7 days, by entity'),
 ('executiveiq.nothroughputbyentity', 'en', 'No tasks completed in the last 7 days');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('executiveiq.liabilitiesbyentity', 'de', 'Verbindlichkeiten und Rückstellungen nach Einheit'),
 ('executiveiq.liabilitiesbyentitysub', 'de', 'Jede Einheit, nach Währung'),
 ('executiveiq.noliabilitiesbyentity', 'de', 'Noch keine auflaufenden Rechnungen'),
 ('executiveiq.supplierconcentration', 'de', 'Lieferantenkonzentration über Einheiten hinweg'),
 ('executiveiq.supplierconcentrationsub', 'de', 'Lieferanten unter den Top 5 in 2 oder mehr Einheiten'),
 ('executiveiq.nosupplierconcentration', 'de', 'Kein Lieferant ist Top-Lieferant in mehr als einer Einheit'),
 ('executiveiq.supplier', 'de', 'Lieferant'),
 ('executiveiq.entitycount', 'de', 'Einheiten'),
 ('executiveiq.entities', 'de', 'Top-Lieferant in'),
 ('executiveiq.exceptiontrendsbyentity', 'de', 'Ausnahme- und Betrugssignaltrend über Einheiten hinweg'),
 ('executiveiq.exceptiontrendsbyentitysub', 'de', 'Jede Einheit, über 8 Wochen verfolgt'),
 ('executiveiq.noexceptiontrendsbyentity', 'de', 'Keine Ausnahmen in den letzten 8 Wochen'),
 ('executiveiq.entity', 'de', 'Einheit'),
 ('executiveiq.throughputbyentity', 'de', 'Durchsatz-/Arbeitslastvergleich über Organisationen hinweg'),
 ('executiveiq.throughputbyentitysub', 'de', 'Abgeschlossene Aufgaben der letzten 7 Tage, nach Einheit'),
 ('executiveiq.nothroughputbyentity', 'de', 'Keine abgeschlossenen Aufgaben in den letzten 7 Tagen');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('executiveiq.liabilitiesbyentity','executiveiq.liabilitiesbyentitysub','executiveiq.noliabilitiesbyentity','executiveiq.supplierconcentration','executiveiq.supplierconcentrationsub','executiveiq.nosupplierconcentration','executiveiq.supplier','executiveiq.entitycount','executiveiq.entities','executiveiq.exceptiontrendsbyentity','executiveiq.exceptiontrendsbyentitysub','executiveiq.noexceptiontrendsbyentity','executiveiq.entity','executiveiq.throughputbyentity','executiveiq.throughputbyentitysub','executiveiq.nothroughputbyentity') == 32
