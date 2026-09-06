-- 0024_sources_screen_strings.sql
-- Decision 0126 — the words the sources screen needs.
INSERT INTO ui_strings (key, locale, value) VALUES ('nav.sources', 'en', 'Sources');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.subtitle', 'en', 'Where invoices arrive');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.name', 'en', 'Source');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.mechanism', 'en', 'Arrives by');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.process', 'en', 'Process');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.address', 'en', 'Address');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.claim', 'en', 'Create address');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.empty', 'en', 'No sources configured.');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.failed', 'en', 'Could not load sources.');
-- The routing state, said plainly. 'Not receiving yet' rather than
-- 'not configured', because the person reading it wants to know whether
-- to tell their suppliers, not what our column says.
INSERT INTO ui_strings (key, locale, value) VALUES ('routing.not_configured', 'en', 'Not receiving yet');
INSERT INTO ui_strings (key, locale, value) VALUES ('routing.active', 'en', 'Receiving');
INSERT INTO ui_strings (key, locale, value) VALUES ('routing.suspended', 'en', 'Suspended');

INSERT INTO ui_strings (key, locale, value) VALUES ('nav.sources', 'de', 'Quellen');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.subtitle', 'de', 'Wo Rechnungen eingehen');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.name', 'de', 'Quelle');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.mechanism', 'de', 'Eingang über');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.process', 'de', 'Prozess');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.address', 'de', 'Adresse');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.claim', 'de', 'Adresse erstellen');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.empty', 'de', 'Keine Quellen konfiguriert.');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.failed', 'de', 'Quellen konnten nicht geladen werden.');
INSERT INTO ui_strings (key, locale, value) VALUES ('routing.not_configured', 'de', 'Noch kein Empfang');
INSERT INTO ui_strings (key, locale, value) VALUES ('routing.active', 'de', 'Empfängt');
INSERT INTO ui_strings (key, locale, value) VALUES ('routing.suspended', 'de', 'Ausgesetzt');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'sources.%' OR key LIKE 'routing.%' OR key = 'nav.sources' == 24
