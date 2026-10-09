-- 0316_line_columns_strings.sql
-- Decision 0705 — a supplier's line table is learned: which column holds the
-- quantity, unit price and VAT rate, and the heading printed over each.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('suppliers.layouts.columns', 'en', 'Line columns known: {columns}'),
 ('suppliers.layouts.columns', 'de', 'Bekannte Positionsspalten: {columns}');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'suppliers.layouts.columns' == 2
