-- 0317_line_net_suggestion_strings.sql
-- Decision 0708 — under a line's net amount, the viewer suggests quantity ×
-- unit price where the amount is empty or differs, or the net of an amount
-- that included VAT.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.linecalc.calc', 'en', '= {amount} ({qty} × {price})'),
 ('viewer.linecalc.calc', 'de', '= {amount} ({qty} × {price})'),
 ('viewer.linecalc.gross', 'en', 'Includes {rate}% VAT: net {amount}'),
 ('viewer.linecalc.gross', 'de', 'Enthält {rate} % MwSt.: netto {amount}'),
 ('viewer.linecalc.use', 'en', 'Use'),
 ('viewer.linecalc.use', 'de', 'Übernehmen');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'viewer.linecalc.%' == 6
