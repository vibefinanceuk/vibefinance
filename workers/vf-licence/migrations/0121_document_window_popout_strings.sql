-- 0121_document_window_popout_strings.sql
-- Decision 0384, phase 4 of docs/design/document-viewer.md. Expand now
-- opens document-window.html, a page of our own, in place of decision
-- 0073's raw signed file URL — these four strings are everything new
-- it needed a word for: the browser refusing the pop-up outright, the
-- embedded card's own placeholder once one is open, and its two
-- actions.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.popupblocked', 'en', 'Your browser blocked the pop-up window. Allow pop-ups for this site and try again.'),
 ('viewer.openinwindow', 'en', 'Open in a separate window'),
 ('viewer.bringtofront', 'en', 'Bring to front'),
 ('viewer.showhere', 'en', 'Show here instead');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.popupblocked', 'de', 'Ihr Browser hat das Pop-up-Fenster blockiert. Erlauben Sie Pop-ups für diese Website und versuchen Sie es erneut.'),
 ('viewer.openinwindow', 'de', 'In einem separaten Fenster geöffnet'),
 ('viewer.bringtofront', 'de', 'In den Vordergrund holen'),
 ('viewer.showhere', 'de', 'Stattdessen hier anzeigen');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('viewer.popupblocked','viewer.openinwindow','viewer.bringtofront','viewer.showhere') == 8
