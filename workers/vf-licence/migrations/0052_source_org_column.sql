-- 0052_source_org_column.sql
-- Decision 0204 — which org a source places its documents in.
--
-- **`<Automatic>` sits among the orgs**, not beside them: *"one email
-- per org"* and *"one email for everybody"* are the same setting rather
-- than two mechanisms.
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.org', 'en', 'Business unit');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.orgautomatic', 'en', 'Automatic — read from the document');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.orgfailed', 'en', 'That business unit could not be set.');

INSERT INTO ui_strings (key, locale, value) VALUES ('sources.org', 'de', 'Geschäftsbereich');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.orgautomatic', 'de', 'Automatisch — aus dem Beleg');
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.orgfailed', 'de', 'Dieser Geschäftsbereich konnte nicht gesetzt werden.');

-- Point-in-time: all three exist in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('sources.org','sources.orgautomatic','sources.orgfailed') == 6
