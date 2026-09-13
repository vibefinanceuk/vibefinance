-- 0086_header_fields_popout.sql
-- Decision 0291 — the Invoice header card becomes a curated summary,
-- with a pop-out (matching the Supplier screen's own pattern) for
-- every configured field the summary doesn't show room for.
INSERT INTO ui_strings (key, locale, value) VALUES
  ('action.headerfields', 'en', 'Header Fields'),
  ('viewer.allheaderfields', 'en', 'All invoice header fields'),
  ('action.headerfields', 'de', 'Kopfdaten'),
  ('viewer.allheaderfields', 'de', 'Alle Rechnungskopf-Felder');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('action.headerfields','viewer.allheaderfields') == 4
