-- 0072_who_holds_it.sql
-- Decision 0250 — who holds the work at a stage.
--
-- **Three words for three genuinely different situations.** *Mine* is
-- work I am responsible for; *taken* is work somebody has and I need
-- nothing from; *unclaimed* is the one that grows quietly, because
-- nobody is holding it and nobody is neglecting it either.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('dash.mine', 'en', 'Mine'),
 ('dash.theirs', 'en', 'Taken'),
 ('dash.unclaimed', 'en', 'Unclaimed'),
 ('dash.showmine', 'en', 'Show mine');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('dash.mine', 'de', 'Meine'),
 ('dash.theirs', 'de', 'Übernommen'),
 ('dash.unclaimed', 'de', 'Nicht übernommen'),
 ('dash.showmine', 'de', 'Meine anzeigen');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('dash.mine','dash.theirs','dash.unclaimed','dash.showmine') == 8
