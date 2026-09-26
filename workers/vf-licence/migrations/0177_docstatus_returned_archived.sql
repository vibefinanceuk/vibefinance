-- 0177_docstatus_returned_archived.sql
-- Decision 0501 — `statusOf()` in `vf-app`'s Documents route learned
-- two more instance statuses (`returned_manually`, `archived`,
-- decision 0055/0498) that had fallen through to "Waiting"/"In
-- progress" ever since those statuses existed. Genuinely new keys.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('docstatus.returned', 'en', 'Returned to supplier'),
 ('docstatus.archived', 'en', 'Archived');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('docstatus.returned', 'de', 'An Lieferant zurückgegeben'),
 ('docstatus.archived', 'de', 'Archiviert');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('docstatus.returned', 'docstatus.archived') == 4
