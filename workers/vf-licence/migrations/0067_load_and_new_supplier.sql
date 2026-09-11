-- 0067_load_and_new_supplier.sql
-- Decision 0237 — the two ways a supplier gets into the list.
--
-- **"New supplier", not "Record a new supplier."** Beside a *Load*
-- button of the same size, a label three times as long stops being a
-- label and starts being a sentence — and the two are a pair a person
-- reads together.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.newsupplier', 'en', 'New supplier'),
 ('action.load', 'en', 'Load'),
 ('action.newsupplier', 'de', 'Neuer Lieferant'),
 ('action.load', 'de', 'Laden');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('action.newsupplier','action.load') == 4
