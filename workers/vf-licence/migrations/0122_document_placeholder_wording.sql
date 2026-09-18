-- 0122_document_placeholder_wording.sql
-- Decision 0393. Reported live, against the deployed 0392 layout: the
-- pop-out placeholder's text should move to the left of the card and
-- read "Document open in a separate window" rather than "Open in a
-- separate window" — "Document" says what is open, once the text sits
-- beside the actions rather than above them.
--
-- An UPDATE, not an edit to migration 0121 itself — that migration is
-- already applied, and an applied migration is not edited without
-- saying so (§6). This is the saying so.
UPDATE ui_strings SET value = 'Document open in a separate window' WHERE key = 'viewer.openinwindow' AND locale = 'en';
UPDATE ui_strings SET value = 'Dokument in einem separaten Fenster geöffnet' WHERE key = 'viewer.openinwindow' AND locale = 'de';

-- Point-in-time: both locales carry the new wording.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'viewer.openinwindow' AND value IN ('Document open in a separate window', 'Dokument in einem separaten Fenster geöffnet') == 2
