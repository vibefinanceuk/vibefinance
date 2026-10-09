-- 0312_lasso_box_strings.sql
-- Decision 0700 — the lasso draws a box (press, drag to the opposite corner,
-- let go) instead of a freehand loop, and says why it cannot fill a field when
-- nothing on screen may be changed.

UPDATE ui_strings SET value = 'Click a field, then drag a box round its value on the page' WHERE key = 'viewer.lasso.hint' AND locale = 'en';
UPDATE ui_strings SET value = 'Klicken Sie auf ein Feld und ziehen Sie dann einen Rahmen um seinen Wert auf der Seite' WHERE key = 'viewer.lasso.hint' AND locale = 'de';

INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.lasso.claim', 'en', 'Claim this task to fill fields from the document'),
 ('viewer.lasso.claim', 'de', 'Übernehmen Sie diese Aufgabe, um Felder aus dem Dokument zu füllen'),
 ('viewer.lasso.readonly', 'en', 'This stage does not allow changes'),
 ('viewer.lasso.readonly', 'de', 'In dieser Phase sind keine Änderungen möglich');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('viewer.lasso.claim','viewer.lasso.readonly') == 4
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'viewer.lasso.hint' AND value LIKE '%box%' == 1
