-- 0136_fraud_prevention_statistical_outliers_and_segregation_of_duties_strings.sql
--
-- Decision 0424 — the Fraud Prevention tab's fourth and fifth real
-- metrics, built together at the operator's own request ("Can you
-- tackle 1 and 2"):
--
--   "Statistical outliers — an invoice amount well outside a
--   supplier's own historical range" (the design's own third bullet
--   under Screen 3 — Fraud & Risk Detection's key metrics), and
--
--   "Segregation-of-duties flags — the same person claiming and
--   approving where the process should prevent it" (the design's own
--   sixth bullet, same screen).
--
-- Both gated on `AP.FraudReview`. Reuses `fraudprevention.
-- invoicenumber` / `.supplier` / `.amount` / `.issuedate` (decision
-- 0420's own migration 0132) and `fraudprevention.user` (decision
-- 0423's own migration 0135).
INSERT INTO ui_strings (key, locale, value) VALUES
 ('fraudprevention.statisticaloutliers', 'en', 'Statistical outliers'),
 ('fraudprevention.statisticaloutlierssub', 'en', 'An amount well outside the supplier''s own historical range'),
 ('fraudprevention.nostatisticaloutliers', 'en', 'No statistical outliers right now'),
 ('fraudprevention.historicalmean', 'en', 'Historical average'),
 ('fraudprevention.deviation', 'en', 'Deviation'),
 ('fraudprevention.undefinedmagnitude', 'en', 'Undefined magnitude'),
 ('fraudprevention.segregationofduties', 'en', 'Segregation-of-duties flags'),
 ('fraudprevention.segregationofdutiessub', 'en', 'The same person claiming and approving the same invoice'),
 ('fraudprevention.nosegregationofduties', 'en', 'No segregation-of-duties flags right now'),
 ('fraudprevention.stagescompleted', 'en', 'Stages completed');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('fraudprevention.statisticaloutliers', 'de', 'Statistische Ausreißer'),
 ('fraudprevention.statisticaloutlierssub', 'de', 'Ein Betrag deutlich außerhalb der bisherigen Spanne des Lieferanten'),
 ('fraudprevention.nostatisticaloutliers', 'de', 'Derzeit keine statistischen Ausreißer'),
 ('fraudprevention.historicalmean', 'de', 'Historischer Durchschnitt'),
 ('fraudprevention.deviation', 'de', 'Abweichung'),
 ('fraudprevention.undefinedmagnitude', 'de', 'Unbestimmte Abweichung'),
 ('fraudprevention.segregationofduties', 'de', 'Funktionstrennungs-Hinweise'),
 ('fraudprevention.segregationofdutiessub', 'de', 'Dieselbe Person hat beantragt und genehmigt'),
 ('fraudprevention.nosegregationofduties', 'de', 'Derzeit keine Funktionstrennungs-Hinweise'),
 ('fraudprevention.stagescompleted', 'de', 'Abgeschlossene Schritte');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('fraudprevention.statisticaloutliers','fraudprevention.statisticaloutlierssub','fraudprevention.nostatisticaloutliers','fraudprevention.historicalmean','fraudprevention.deviation','fraudprevention.undefinedmagnitude','fraudprevention.segregationofduties','fraudprevention.segregationofdutiessub','fraudprevention.nosegregationofduties','fraudprevention.stagescompleted') == 20
