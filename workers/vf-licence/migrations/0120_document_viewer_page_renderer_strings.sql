-- 0120_document_viewer_page_renderer_strings.sql
-- Decision 0382 — the page renderer's own controls, phase 2 of
-- docs/design/document-viewer.md. viewer.pageof reuses the {n}/{total}
-- placeholder shape decision 0378's suppliers.rangeof already uses for
-- {start}/{end}/{total}.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.zoomin', 'en', 'Zoom in'),
 ('viewer.zoomout', 'en', 'Zoom out'),
 ('viewer.rotate', 'en', 'Rotate'),
 ('viewer.pageof', 'en', 'Page {n} of {total}'),
 ('viewer.thumbnails', 'en', 'Page thumbnails');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.zoomin', 'de', 'Vergrößern'),
 ('viewer.zoomout', 'de', 'Verkleinern'),
 ('viewer.rotate', 'de', 'Drehen'),
 ('viewer.pageof', 'de', 'Seite {n} von {total}'),
 ('viewer.thumbnails', 'de', 'Seitenminiaturen');
