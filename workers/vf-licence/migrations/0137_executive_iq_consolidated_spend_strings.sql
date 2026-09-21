-- 0137_executive_iq_consolidated_spend_strings.sql
--
-- Decision 0425 — the Multi-Enterprise CFO View's first real metric,
-- "Consolidated spend across org units / legal entities" (the
-- design's own first bullet under Screen 5 — Multi-Enterprise View
-- (Office of the CFO)'s key metrics), gated on `AP.Analysis` and
-- `holdsEverywhere`. First use of the `executiveiq.*` namespace —
-- `apanalytics.executiveiq` (the tab's own label, migration 0129) is
-- a different key and untouched here.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('executiveiq.consolidatedspend', 'en', 'Consolidated spend across org units / legal entities'),
 ('executiveiq.consolidatedspendsub', 'en', 'Every entity, by currency'),
 ('executiveiq.noconsolidatedspend', 'en', 'No priced, placed invoices yet'),
 ('executiveiq.legalentity', 'en', 'Legal entity'),
 ('executiveiq.operatingunit', 'en', 'Operating unit');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('executiveiq.consolidatedspend', 'de', 'Konsolidierter Umsatz nach Organisationseinheit / Rechtsträger'),
 ('executiveiq.consolidatedspendsub', 'de', 'Jede Einheit, nach Währung'),
 ('executiveiq.noconsolidatedspend', 'de', 'Noch keine bepreisten, zugeordneten Rechnungen'),
 ('executiveiq.legalentity', 'de', 'Rechtsträger'),
 ('executiveiq.operatingunit', 'de', 'Organisationseinheit');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('executiveiq.consolidatedspend','executiveiq.consolidatedspendsub','executiveiq.noconsolidatedspend','executiveiq.legalentity','executiveiq.operatingunit') == 10
