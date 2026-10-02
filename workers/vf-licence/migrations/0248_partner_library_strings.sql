-- 0248_partner_library_strings.sql
-- Decision 0601. Partner connectors in the Route library.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('library.publisher.partner', 'en', 'Partner · {name}'),
 ('library.publisher.partner', 'de', 'Partner · {name}'),
 ('library.filter.partner', 'en', 'Partner'),
 ('library.filter.partner', 'de', 'Partner'),
 ('library.withdrawn', 'en', 'No longer offered'),
 ('library.withdrawn', 'de', 'Nicht mehr angeboten'),
 ('library.format.mapped', 'en', 'Its own layout'),
 ('library.format.mapped', 'de', 'Eigenes Layout'),
 ('library.partnerfailed', 'en', 'Partners'' connectors could not be fetched just now. Those already added keep working.'),
 ('library.partnerfailed', 'de', 'Die Connectors der Partner konnten gerade nicht abgerufen werden. Bereits hinzugefügte arbeiten weiter.'),
 ('library.listsneeded', 'en', 'Look-up lists it reads:'),
 ('library.listsneeded', 'de', 'Nachschlagelisten, die es liest:'),
 ('library.listempty', 'en', '{name} (empty: fill it in under Look-up lists)'),
 ('library.listempty', 'de', '{name} (leer: unter Nachschlagelisten ausfüllen)'),
 ('library.mappingupdated', 'en', 'Its outbound mapping now follows the new version.'),
 ('library.mappingupdated', 'de', 'Das Ausgangs-Mapping folgt jetzt der neuen Version.'),
 ('library.mappingkept', 'en', 'Your own changes to the outbound mapping were kept, so it does not follow the new version.'),
 ('library.mappingkept', 'de', 'Ihre eigenen Änderungen am Ausgangs-Mapping wurden beibehalten, daher folgt es nicht der neuen Version.');

-- The library's note said partners' connectors come later: they are here now.
UPDATE ui_strings SET value = 'Standard connectors are kept up to date by VibeFinance, and partners'' connectors by their partner, each version approved by VibeFinance. A later version is offered to each route made from one.' WHERE key = 'library.note' AND locale = 'en';
UPDATE ui_strings SET value = 'Standard-Connectors hält VibeFinance aktuell, Partner-Connectors ihr Partner, jede Version von VibeFinance freigegeben. Jeder daraus erstellten Route wird eine neuere Version angeboten.' WHERE key = 'library.note' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('library.publisher.partner','library.filter.partner','library.withdrawn','library.format.mapped','library.partnerfailed','library.listsneeded','library.listempty','library.mappingupdated','library.mappingkept') == 18
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'library.note' AND value LIKE '%approved by VibeFinance%' == 1
