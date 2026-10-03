-- 0261_fraud_drilldown_strings.sql
-- Decision 0618. Fraud Prevention: tiles on top, a short list per check
-- with Show all, and rows that open their invoice or Documents.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('fraudprevention.showall', 'en', 'Show all {n}'),
 ('fraudprevention.showall', 'de', 'Alle {n} anzeigen'),
 ('documents.showing.check', 'en', 'Showing the invoices in {check}'),
 ('documents.showing.check', 'de', 'Zeigt die Rechnungen aus {check}'),
 ('documents.showing.exceptionsfor', 'en', 'Showing failed validations for {name} in the last 8 weeks'),
 ('documents.showing.exceptionsfor', 'de', 'Zeigt fehlgeschlagene Prüfungen für {name} in den letzten 8 Wochen');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('fraudprevention.showall','documents.showing.check','documents.showing.exceptionsfor') == 6
