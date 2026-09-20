-- 0129_ap_analytics_strings.sql
--
-- Decision 0417 — AP Analytics, the tabbed home the operator asked for
-- once Workload (0415) and Supplier Performance (0416) had both
-- shipped as their own standalone screens: "I was hoping to have an
-- AP Analytics link, with all dashboard available via tabs... similar
-- pill-box tabs seen in the Access screen." Five tabs, named by the
-- operator directly: Operational Performance, Financial Performance,
-- Supplier Performance, Executive IQ, Fraud Prevention. Two are real
-- (Operational and Supplier, reusing 0415's and 0416's own strings for
-- their card content); the other three render `apanalytics.notbuilt`
-- behind their own real permission gate.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('nav.apanalytics', 'en', 'AP Analytics'),
 ('apanalytics.heading', 'en', 'AP Analytics'),
 ('apanalytics.sub', 'en', 'Every AP analytics screen, in one place'),
 ('apanalytics.operational', 'en', 'Operational Performance'),
 ('apanalytics.financial', 'en', 'Financial Performance'),
 ('apanalytics.supplier', 'en', 'Supplier Performance'),
 ('apanalytics.executiveiq', 'en', 'Executive IQ'),
 ('apanalytics.fraud', 'en', 'Fraud Prevention'),
 ('apanalytics.notbuilt', 'en', 'Not built yet'),
 ('apanalytics.loaderror', 'en', 'Could not load this tab right now'),
 ('apanalytics.none', 'en', 'No AP Analytics tabs are available to you');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('nav.apanalytics', 'de', 'Kreditoren-Analyse'),
 ('apanalytics.heading', 'de', 'Kreditoren-Analyse'),
 ('apanalytics.sub', 'de', 'Alle Kreditoren-Analysen an einem Ort'),
 ('apanalytics.operational', 'de', 'Operative Leistung'),
 ('apanalytics.financial', 'de', 'Finanzielle Leistung'),
 ('apanalytics.supplier', 'de', 'Lieferantenleistung'),
 ('apanalytics.executiveiq', 'de', 'Executive IQ'),
 ('apanalytics.fraud', 'de', 'Betrugsprävention'),
 ('apanalytics.notbuilt', 'de', 'Noch nicht verfügbar'),
 ('apanalytics.loaderror', 'de', 'Dieser Tab konnte gerade nicht geladen werden'),
 ('apanalytics.none', 'de', 'Für Sie sind keine Kreditoren-Analyse-Tabs verfügbar');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('nav.apanalytics','apanalytics.heading','apanalytics.sub','apanalytics.operational','apanalytics.financial','apanalytics.supplier','apanalytics.executiveiq','apanalytics.fraud','apanalytics.notbuilt','apanalytics.loaderror','apanalytics.none') == 22
