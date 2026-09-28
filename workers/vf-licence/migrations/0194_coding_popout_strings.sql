-- 0194_coding_popout_strings.sql
-- Decision 0539. The redesigned Coding pop-out: its title and context,
-- the per-line suggestion with Accept all, and applying the coding to
-- the other uncoded lines.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.coding.linetitle', 'en', 'Line {n} coding'),
 ('viewer.coding.ctx.company', 'en', 'Company'),
 ('viewer.coding.ctx.supplier', 'en', 'Supplier'),
 ('viewer.coding.ctx.nonpo', 'en', 'Non-PO line'),
 ('viewer.coding.sug.title', 'en', 'Suggested coding'),
 ('viewer.coding.sug.accept', 'en', 'Accept all'),
 ('viewer.coding.sug.similar', 'en', '{pct}% · {count} of {total} earlier {supplier} lines like this one were coded this way'),
 ('viewer.coding.sug.supplier', 'en', '{pct}% · {count} of {total} coded {supplier} lines use this coding'),
 ('viewer.coding.sug.examples', 'en', 'For example {examples}'),
 ('viewer.coding.sug.accepted', 'en', 'Suggestion accepted. Save the invoice to keep it.'),
 ('viewer.coding.applyothers', 'en', 'Also apply this coding to the other uncoded lines ({lines})'),
 ('viewer.coding.savehint', 'en', 'Coding is kept when you save the invoice.'),
 ('viewer.coding.done', 'en', 'Done');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.coding.linetitle', 'de', 'Kontierung Position {n}'),
 ('viewer.coding.ctx.company', 'de', 'Buchungskreis'),
 ('viewer.coding.ctx.supplier', 'de', 'Lieferant'),
 ('viewer.coding.ctx.nonpo', 'de', 'Position ohne Bestellung'),
 ('viewer.coding.sug.title', 'de', 'Vorgeschlagene Kontierung'),
 ('viewer.coding.sug.accept', 'de', 'Alle übernehmen'),
 ('viewer.coding.sug.similar', 'de', '{pct} % · {count} von {total} früheren ähnlichen Positionen von {supplier} wurden so kontiert'),
 ('viewer.coding.sug.supplier', 'de', '{pct} % · {count} von {total} kontierten Positionen von {supplier} nutzen diese Kontierung'),
 ('viewer.coding.sug.examples', 'de', 'Zum Beispiel {examples}'),
 ('viewer.coding.sug.accepted', 'de', 'Vorschlag übernommen. Zum Behalten die Rechnung speichern.'),
 ('viewer.coding.applyothers', 'de', 'Diese Kontierung auch auf die übrigen nicht kontierten Positionen anwenden ({lines})'),
 ('viewer.coding.savehint', 'de', 'Die Kontierung wird beim Speichern der Rechnung übernommen.'),
 ('viewer.coding.done', 'de', 'Fertig');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('viewer.coding.linetitle', 'viewer.coding.ctx.company', 'viewer.coding.ctx.supplier', 'viewer.coding.ctx.nonpo', 'viewer.coding.sug.title', 'viewer.coding.sug.accept', 'viewer.coding.sug.similar', 'viewer.coding.sug.supplier', 'viewer.coding.sug.examples', 'viewer.coding.sug.accepted', 'viewer.coding.applyothers', 'viewer.coding.savehint', 'viewer.coding.done') == 26
