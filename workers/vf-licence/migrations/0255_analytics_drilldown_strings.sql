-- 0255_analytics_drilldown_strings.sql
-- Decision 0611. AP Analytics bars open Documents: two banners.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('documents.showing.doneby', 'en', 'Showing what {name} completed in the last 7 days'),
 ('documents.showing.doneby', 'de', 'Zeigt, was {name} in den letzten 7 Tagen erledigt hat'),
 ('documents.showing.team', 'en', 'Showing what is open in {team}''s queue'),
 ('documents.showing.team', 'de', 'Zeigt, was in der Warteschlange von {team} offen ist');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('documents.showing.doneby','documents.showing.team') == 4
