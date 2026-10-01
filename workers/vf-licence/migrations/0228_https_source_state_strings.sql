-- 0228_https_source_state_strings.sql
-- Decision 0580. An HTTPS source's card on Process routes says whether it
-- receives: Receiving (routing.active) once it has a live key, otherwise
-- No keys yet.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('processroutes.nokeys', 'en', 'No keys yet'),
 ('processroutes.nokeys', 'de', 'Noch keine Schlüssel');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'processroutes.nokeys' == 2
