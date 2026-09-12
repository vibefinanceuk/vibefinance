-- 0076_what_i_acted_on.sql
--
-- Decision 0265 — "Done" redefined at the operator's own request: a
-- daily count of items I have personally acted on this week, Monday
-- through Sunday, with a total that links through to Documents.
--
-- **`dash.todaylabel`, `dash.weeklabel`, `dash.minelabel` are left in
-- place, unused** — decision 0071's rule: a string a customer may
-- already have translated is not something to remove in passing.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('dash.donesub', 'en', 'What I have acted on, by day'),
 ('dash.thisweek', 'en', 'this week'),
 ('dash.day.mon', 'en', 'M'),
 ('dash.day.tue', 'en', 'T'),
 ('dash.day.wed', 'en', 'W'),
 ('dash.day.thu', 'en', 'T'),
 ('dash.day.fri', 'en', 'F'),
 ('dash.day.sat', 'en', 'S'),
 ('dash.day.sun', 'en', 'S'),
 ('documents.showing.donebyme', 'en', 'Showing what I completed this week');

-- **German day initials are genuinely different letters**, not the
-- same collisions English happens to have (Tuesday/Thursday sharing
-- "T", Saturday/Sunday sharing "S") — Montag, Dienstag, Mittwoch,
-- Donnerstag, Freitag, Samstag, Sonntag give seven mostly-distinct
-- initials of their own, and forcing them into English's collision
-- pattern would be wrong rather than merely untranslated.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('dash.donesub', 'de', 'Was ich heute bearbeitet habe, je Tag'),
 ('dash.thisweek', 'de', 'diese Woche'),
 ('dash.day.mon', 'de', 'M'),
 ('dash.day.tue', 'de', 'D'),
 ('dash.day.wed', 'de', 'M'),
 ('dash.day.thu', 'de', 'D'),
 ('dash.day.fri', 'de', 'F'),
 ('dash.day.sat', 'de', 'S'),
 ('dash.day.sun', 'de', 'S'),
 ('documents.showing.donebyme', 'de', 'Zeigt, was ich diese Woche erledigt habe');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('dash.donesub','dash.thisweek','dash.day.mon','dash.day.tue','dash.day.wed','dash.day.thu','dash.day.fri','dash.day.sat','dash.day.sun','documents.showing.donebyme') == 20
