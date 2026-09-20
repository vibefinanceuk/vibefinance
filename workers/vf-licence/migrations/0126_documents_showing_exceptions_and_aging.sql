-- 0126_documents_showing_exceptions_and_aging.sql
-- Decision 0411 — the Documents screen's own banner text for the two
-- new filters "Exceptions by Supplier" and "Task Aging Report" now
-- click through to, matching decision 0075/0076's own
-- "Showing X only" pattern for every other alert this screen carries.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('documents.showing.exceptionsupplier', 'en', 'Showing {supplier}''s recent exceptions only'),
 ('documents.showing.aging', 'en', 'Showing open work aged {bucket} only');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('documents.showing.exceptionsupplier', 'de', 'Zeigt nur die jüngsten Ausnahmen von {supplier}'),
 ('documents.showing.aging', 'de', 'Zeigt nur offene Arbeit im Alter {bucket}');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('documents.showing.exceptionsupplier','documents.showing.aging') == 4
