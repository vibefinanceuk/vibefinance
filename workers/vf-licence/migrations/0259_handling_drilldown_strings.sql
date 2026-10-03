-- 0259_handling_drilldown_strings.sql
-- Decision 0616. Average handling time and claim-to-complete cycle time
-- open Documents at what a person claimed and completed.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('documents.showing.handledby', 'en', 'Showing where {name} claimed and completed a task'),
 ('documents.showing.handledby', 'de', 'Zeigt, wo {name} eine Aufgabe übernommen und erledigt hat'),
 ('documents.showing.handledbystage', 'en', 'Showing where {name} claimed and completed a task at {stage}'),
 ('documents.showing.handledbystage', 'de', 'Zeigt, wo {name} eine Aufgabe bei {stage} übernommen und erledigt hat');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('documents.showing.handledby','documents.showing.handledbystage') == 4
