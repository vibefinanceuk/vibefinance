-- 0075_showing_one_stage.sql
--
-- Decision 0264 — a link from the dashboard's "Where things are" donut
-- to the documents at whichever stage was clicked.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('documents.showing.stage', 'en', 'Showing documents at {stage} only');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('documents.showing.stage', 'de', 'Zeigt nur Belege bei {stage}');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'documents.showing.stage' == 2
