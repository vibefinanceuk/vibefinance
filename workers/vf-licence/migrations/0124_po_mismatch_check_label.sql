-- 0124_po_mismatch_check_label.sql
-- Decision 0400 — the new `po_mismatch` check gets a label, same as
-- every check decision 0022 already named.
--
-- Worded like the others ("does not equal", "differs from") rather
-- than naming the field codes — the person reading it is looking at
-- the document, not at BT-13/BT-112. Unlike the original six, this
-- one is checked against a linked purchase order rather than the
-- document's own numbers, which is why decision 0400 gave it `danger`
-- rather than `warning` — but the label itself only needs to say what
-- is wrong.
INSERT INTO ui_strings (key, locale, value) VALUES ('check.po_mismatch', 'en', 'Does not match the purchase order');

INSERT INTO ui_strings (key, locale, value) VALUES ('check.po_mismatch', 'de', 'Stimmt nicht mit der Bestellung überein');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'check.po_mismatch' == 2
