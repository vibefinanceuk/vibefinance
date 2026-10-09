-- 0313_value_from_document_strings.sql
-- Decision 0701 — where each header value is on its document is recorded;
-- a value a person took from the document with the box, and kept, is a line
-- on the Timeline.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('activity.fromdocument', 'en', '{who} took {field} from page {page} of the document'),
 ('activity.fromdocument', 'de', '{who} hat {field} von Seite {page} des Dokuments übernommen'),
 ('activity.fromdocument.corrected', 'en', '{who} corrected {field} from page {page} of the document'),
 ('activity.fromdocument.corrected', 'de', '{who} hat {field} anhand von Seite {page} des Dokuments korrigiert');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'activity.fromdocument%' == 4
