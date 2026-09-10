-- 0051_document_unit_column.sql
-- Decision 0193 — which part of the business a document belongs to.
--
-- `invoice_headers.org_unit_id` has existed since decision 0036 and no
-- screen has ever shown it.
INSERT INTO ui_strings (key, locale, value) VALUES ('column.unit', 'en', 'Business unit');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.nounit', 'en', 'Unassigned');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.allunits', 'en', 'All business units');

INSERT INTO ui_strings (key, locale, value) VALUES ('column.unit', 'de', 'Geschäftsbereich');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.nounit', 'de', 'Nicht zugeordnet');
INSERT INTO ui_strings (key, locale, value) VALUES ('documents.allunits', 'de', 'Alle Geschäftsbereiche');

-- Point-in-time: all three exist in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('column.unit','documents.nounit','documents.allunits') == 6
