-- 0123_document_page_cycling_and_highlight_strings.sql
-- Decision 0394 — next/previous page cycling and the highlight tool,
-- both added to the page renderer's own control row.
--
-- viewer.previouspage/viewer.nextpage reuse the exact English wording
-- decision 0376's own pagination strings already established
-- (purchaseorders.previouspage/nextpage, 0115; suppliers.*, 0118) —
-- one pair of words for "go back/forward a page" everywhere it reads,
-- not a viewer-specific phrasing.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.previouspage', 'en', 'Previous page'),
 ('viewer.nextpage', 'en', 'Next page'),
 ('viewer.highlight', 'en', 'Highlight');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.previouspage', 'de', 'Vorherige Seite'),
 ('viewer.nextpage', 'de', 'Nächste Seite'),
 ('viewer.highlight', 'de', 'Markieren');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('viewer.previouspage','viewer.nextpage','viewer.highlight') == 6
