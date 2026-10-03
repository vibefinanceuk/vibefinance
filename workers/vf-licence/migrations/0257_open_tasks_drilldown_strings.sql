-- 0257_open_tasks_drilldown_strings.sql
-- Decision 0614. Open tasks by user opens Documents.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('documents.showing.openfor', 'en', 'Showing what is open for {name}'),
 ('documents.showing.openfor', 'de', 'Zeigt, was für {name} offen ist'),
 ('documents.showing.openforstage', 'en', 'Showing what is open for {name} at {stage}'),
 ('documents.showing.openforstage', 'de', 'Zeigt, was für {name} bei {stage} offen ist'),
 ('workload.opentasksopenall', 'en', 'Open all of {name}''s open tasks in Documents'),
 ('workload.opentasksopenall', 'de', 'Alle offenen Aufgaben von {name} unter Dokumente öffnen');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('documents.showing.openfor','documents.showing.openforstage','workload.opentasksopenall') == 6
