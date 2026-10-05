-- 0286_absence_button_strings.sql
-- Decision 0642 — Absence moves to the top bar: Absence, Away or Covering.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('absence.button.none', 'en', 'Absence'),
 ('absence.button.none', 'de', 'Abwesenheit'),
 ('absence.button.away', 'en', 'Away'),
 ('absence.button.away', 'de', 'Abwesend'),
 ('absence.button.covering', 'en', 'Covering'),
 ('absence.button.covering', 'de', 'Vertretung'),
 ('absence.button.awaytitle', 'en', 'Away until {day}'),
 ('absence.button.awaytitle', 'de', 'Abwesend bis {day}');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('absence.button.none', 'absence.button.away', 'absence.button.covering', 'absence.button.awaytitle') == 8
