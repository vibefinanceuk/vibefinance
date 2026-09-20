-- 0135_fraud_prevention_exception_trends_strings.sql
--
-- Decision 0423 — the Fraud Prevention tab's third real metric,
-- "Exceptions by type, by user, by supplier — trended, so a rising
-- exception rate from one supplier or one user is visible before it
-- is a pattern" (the design's own fifth bullet under Screen 3 — Fraud
-- & Risk Detection's key metrics), gated on `AP.FraudReview`. Reuses
-- `fraudprevention.supplier` from decision 0420's own migration 0132.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('fraudprevention.exceptiontrends', 'en', 'Exceptions by type, by user, by supplier'),
 ('fraudprevention.exceptiontrendssub', 'en', 'Trended over the last 8 weeks'),
 ('fraudprevention.noexceptiontrends', 'en', 'No exceptions in the last 8 weeks'),
 ('fraudprevention.exceptioncount', 'en', 'Exceptions'),
 ('fraudprevention.trend', 'en', 'Trend'),
 ('fraudprevention.bysupplier', 'en', 'By supplier'),
 ('fraudprevention.byuser', 'en', 'By user'),
 ('fraudprevention.bytype', 'en', 'By type'),
 ('fraudprevention.user', 'en', 'User'),
 ('fraudprevention.type', 'en', 'Type'),
 ('fraudprevention.nosupplier', 'en', 'No matched supplier');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('fraudprevention.exceptiontrends', 'de', 'Ausnahmen nach Typ, Benutzer, Lieferant'),
 ('fraudprevention.exceptiontrendssub', 'de', 'Verlauf der letzten 8 Wochen'),
 ('fraudprevention.noexceptiontrends', 'de', 'Keine Ausnahmen in den letzten 8 Wochen'),
 ('fraudprevention.exceptioncount', 'de', 'Ausnahmen'),
 ('fraudprevention.trend', 'de', 'Verlauf'),
 ('fraudprevention.bysupplier', 'de', 'Nach Lieferant'),
 ('fraudprevention.byuser', 'de', 'Nach Benutzer'),
 ('fraudprevention.bytype', 'de', 'Nach Typ'),
 ('fraudprevention.user', 'de', 'Benutzer'),
 ('fraudprevention.type', 'de', 'Typ'),
 ('fraudprevention.nosupplier', 'de', 'Kein zugeordneter Lieferant');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('fraudprevention.exceptiontrends','fraudprevention.exceptiontrendssub','fraudprevention.noexceptiontrends','fraudprevention.exceptioncount','fraudprevention.trend','fraudprevention.bysupplier','fraudprevention.byuser','fraudprevention.bytype','fraudprevention.user','fraudprevention.type','fraudprevention.nosupplier') == 22
