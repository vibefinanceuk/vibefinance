-- 0260_analytics_followups_strings.sql
-- Decision 0617. AP Analytics follow-ups: "1 task" in the singular, a
-- period on the handling and cycle time cards, and a search in the open
-- tasks drop-down.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('workload.taskcountnote.one', 'en', '{n} task'),
 ('workload.taskcountnote.one', 'de', '{n} Aufgabe'),
 ('workload.window', 'en', 'Period'),
 ('workload.window', 'de', 'Zeitraum'),
 ('workload.window.all', 'en', 'All time'),
 ('workload.window.all', 'de', 'Gesamter Zeitraum'),
 ('workload.window.days', 'en', 'Last {n} days'),
 ('workload.window.days', 'de', 'Letzte {n} Tage'),
 ('workload.window.none', 'en', 'Nothing claimed and completed in this period'),
 ('workload.window.none', 'de', 'In diesem Zeitraum nichts übernommen und erledigt'),
 ('documents.showing.lastdays', 'en', 'in the last {n} days'),
 ('documents.showing.lastdays', 'de', 'in den letzten {n} Tagen'),
 ('workload.opentasksfind', 'en', 'Find a person'),
 ('workload.opentasksfind', 'de', 'Person suchen'),
 ('workload.opentasksnomatch', 'en', 'No one matches'),
 ('workload.opentasksnomatch', 'de', 'Keine Treffer');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('workload.taskcountnote.one','workload.window','workload.window.all','workload.window.days','workload.window.none','documents.showing.lastdays','workload.opentasksfind','workload.opentasksnomatch') == 16
