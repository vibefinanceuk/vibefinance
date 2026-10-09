-- 0310_lasso_strings.sql
-- Decision 0697 — clicking a field shows where its value is on the
-- document, and a lasso drawn on the document fills the field with focus.
-- The viewer's words for the lasso and for what it found.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.lasso', 'en', 'Lasso'),
 ('viewer.lasso', 'de', 'Lasso'),
 ('viewer.lasso.hint', 'en', 'Click a field, then draw round its value on the page'),
 ('viewer.lasso.hint', 'de', 'Klicken Sie auf ein Feld und umkreisen Sie dann seinen Wert auf der Seite'),
 ('viewer.locate.notext', 'en', 'This document has no text to search yet'),
 ('viewer.locate.notext', 'de', 'Dieses Dokument enthält noch keinen durchsuchbaren Text'),
 ('viewer.locate.notfound', 'en', 'Not found on the document'),
 ('viewer.locate.notfound', 'de', 'Im Dokument nicht gefunden'),
 ('viewer.lasso.notext', 'en', 'This page has no readable text yet'),
 ('viewer.lasso.notext', 'de', 'Diese Seite enthält noch keinen lesbaren Text'),
 ('viewer.lasso.empty', 'en', 'No text inside the lasso'),
 ('viewer.lasso.empty', 'de', 'Kein Text innerhalb des Lassos'),
 ('viewer.lasso.filled', 'en', 'Put in {field}'),
 ('viewer.lasso.filled', 'de', 'In {field} übernommen'),
 ('viewer.lasso.nofield', 'en', 'Click the field to fill first'),
 ('viewer.lasso.nofield', 'de', 'Klicken Sie zuerst auf das zu füllende Feld'),
 ('viewer.lasso.notinlist', 'en', 'Not one of the choices for {field}'),
 ('viewer.lasso.notinlist', 'de', 'Keine der Auswahlmöglichkeiten für {field}'),
 ('viewer.lasso.wrongkind.amount', 'en', 'No amount in the lasso for {field}'),
 ('viewer.lasso.wrongkind.amount', 'de', 'Kein Betrag im Lasso für {field}'),
 ('viewer.lasso.wrongkind.date', 'en', 'No date in the lasso for {field}'),
 ('viewer.lasso.wrongkind.date', 'de', 'Kein Datum im Lasso für {field}'),
 ('viewer.lasso.wrongkind.number', 'en', 'No number in the lasso for {field}'),
 ('viewer.lasso.wrongkind.number', 'de', 'Keine Zahl im Lasso für {field}');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'viewer.lasso%' OR key LIKE 'viewer.locate.%' == 24
