-- 0033_no_domain_string.sql
-- Decision 0141 — the screen says why no address can be issued.
--
-- **A domain nobody owned was hardcoded**, so every address the screen
-- reported as reserved was a string that could never receive anything.
-- With the domain now configuration, an unset one refuses — and the
-- person looking at the screen deserves to know it is our
-- configuration rather than their mistake.
INSERT INTO ui_strings (key, locale, value) VALUES ('outcome.no_ingestion_domain', 'en', 'Email addresses are not available yet. No ingestion domain has been configured.');
INSERT INTO ui_strings (key, locale, value) VALUES ('outcome.no_ingestion_domain', 'de', 'E-Mail-Adressen sind noch nicht verfügbar. Es wurde keine Eingangsdomäne konfiguriert.');

-- Point-in-time: it exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'outcome.no_ingestion_domain' == 2
