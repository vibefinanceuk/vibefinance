-- 0074_the_mover_picker.sql
--
-- Decision 0262 — a two-column mover, replacing the single grid of
-- picker cards. The operator's own picture: "Hidden cards on the left
-- and Displayed cards on the right... center arrows to add or remove."
--
-- **`dash.add` and `dash.pickone` are left in place, unused** — a
-- validation message for a button that could be clicked with nothing
-- chosen has no equivalent now that the add arrow is simply disabled
-- until something is — but decision 0071's rule stands: a string a
-- customer may have translated is not something to remove in passing.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('dash.hiddencards', 'en', 'Hidden cards'),
 ('dash.displayedcards', 'en', 'Displayed cards'),
 ('dash.savechanges', 'en', 'Save changes');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('dash.hiddencards', 'de', 'Ausgeblendete Karten'),
 ('dash.displayedcards', 'de', 'Angezeigte Karten'),
 ('dash.savechanges', 'de', 'Änderungen speichern');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('dash.hiddencards','dash.displayedcards','dash.savechanges') == 6
