-- 0191_po_suggestion_strings.sql
-- Decision 0534. The PO matching panel, phase 4: a suggested PO line
-- for an invoice line with none, why it was suggested, and how many of
-- an invoice's lines look like a searched PO's.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('pomatch.suggest', 'en', 'Suggested: line {n}, {name}'),
 ('pomatch.suggest.score', 'en', '{pct}% match'),
 ('pomatch.suggest.accept', 'en', 'Accept'),
 ('pomatch.suggest.why.itemcode', 'en', 'same item code'),
 ('pomatch.suggest.why.description', 'en', 'similar description'),
 ('pomatch.suggest.why.price', 'en', 'same price'),
 ('pomatch.suggest.why.fits', 'en', 'fits what is left'),
 ('pomatch.why.lines', 'en', '{n} of {total} lines look alike');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('pomatch.suggest', 'de', 'Vorschlag: Position {n}, {name}'),
 ('pomatch.suggest.score', 'de', '{pct} % Übereinstimmung'),
 ('pomatch.suggest.accept', 'de', 'Übernehmen'),
 ('pomatch.suggest.why.itemcode', 'de', 'gleiche Artikelnummer'),
 ('pomatch.suggest.why.description', 'de', 'ähnliche Beschreibung'),
 ('pomatch.suggest.why.price', 'de', 'gleicher Preis'),
 ('pomatch.suggest.why.fits', 'de', 'passt zum Rest'),
 ('pomatch.why.lines', 'de', '{n} von {total} Positionen ähnlich');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'pomatch.suggest%' OR key = 'pomatch.why.lines' == 16
