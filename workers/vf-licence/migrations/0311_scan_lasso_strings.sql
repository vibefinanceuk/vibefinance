-- 0311_scan_lasso_strings.sql
-- Decision 0698 — a scanned page is read into words by Tesseract in the
-- browser the first time a field is looked for on it or a lasso is drawn on
-- it. Decision 0699 — where Tesseract is unsure of a lassoed value, or no
-- field had focus, the lassoed part of the page is read by the AI, which can
-- also say which field it looks like.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.ocr.reading', 'en', 'Reading the page…'),
 ('viewer.ocr.reading', 'de', 'Seite wird gelesen…'),
 ('viewer.lasso.ai.reading', 'en', 'Reading it with AI…'),
 ('viewer.lasso.ai.reading', 'de', 'Wird mit KI gelesen…'),
 ('viewer.lasso.ai.allowance', 'en', 'The AI allowance is used up today: please type it in'),
 ('viewer.lasso.ai.allowance', 'de', 'Das KI-Kontingent ist für heute aufgebraucht: bitte eintippen'),
 ('viewer.lasso.ai.failed', 'en', 'Could not read it: please type it in'),
 ('viewer.lasso.ai.failed', 'de', 'Konnte nicht gelesen werden: bitte eintippen'),
 ('viewer.lasso.suggest', 'en', 'Looks like {field}'),
 ('viewer.lasso.suggest', 'de', 'Sieht aus wie {field}'),
 ('viewer.lasso.suggest.put', 'en', 'Put it there'),
 ('viewer.lasso.suggest.put', 'de', 'Dort eintragen');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'viewer.ocr.reading' OR key LIKE 'viewer.lasso.ai.%' OR key LIKE 'viewer.lasso.suggest%' == 12
