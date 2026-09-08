-- 0046_viewer_heading_labels.sql
-- Decision 0175 — labelling the viewer's own heading.
--
-- **A bare word could be anything.** The heading read `Validation` and
-- the line beneath it a bare identifier; neither said what kind of
-- thing it was.
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.stagelabel', 'en', 'Stage:');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.reflabel', 'en', 'Unique Ref:');

INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.stagelabel', 'de', 'Stufe:');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.reflabel', 'de', 'Referenz:');

-- Point-in-time: both exist in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('viewer.stagelabel','viewer.reflabel') == 4
