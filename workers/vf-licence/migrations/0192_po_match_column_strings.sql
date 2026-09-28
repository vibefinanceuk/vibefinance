-- 0192_po_match_column_strings.sql
-- Decision 0536. The invoice line Match column: a chip per line, its
-- hover legend, the read-only pop-out, and an accepted suggestion told
-- apart from a pairing made by hand.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('pomatch.col.match', 'en', 'Match'),
 ('pomatch.legend.ok', 'en', 'Green: matches its PO line'),
 ('pomatch.legend.warn', 'en', 'Amber: PO line found, but outside tolerance'),
 ('pomatch.legend.bad', 'en', 'Red: no PO line for this invoice line'),
 ('pomatch.legend.dot', 'en', 'Dot: paired by a person, not by the supplier''s reference'),
 ('pomatch.chip.matched', 'en', 'L{n} ✓'),
 ('pomatch.chip.over', 'en', 'L{n} · {pct}'),
 ('pomatch.chip.unit', 'en', 'L{n} · unit'),
 ('pomatch.chip.check', 'en', 'L{n} · check'),
 ('pomatch.chip.nopoline', 'en', 'No PO line'),
 ('pomatch.suggestedby', 'en', 'Suggestion accepted by {who}'),
 ('pomatch.pop.title', 'en', 'Line {n} against the PO'),
 ('pomatch.pop.sub', 'en', 'Purchase order {po}'),
 ('pomatch.pop.invoice', 'en', 'Invoice line'),
 ('pomatch.pop.po', 'en', 'PO line'),
 ('pomatch.pop.open', 'en', 'Open PO matching'),
 ('pomatch.pop.readonly', 'en', 'Read-only here. To change the matching, return the invoice to the Matching stage.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('pomatch.col.match', 'de', 'Abgleich'),
 ('pomatch.legend.ok', 'de', 'Grün: stimmt mit der Bestellposition überein'),
 ('pomatch.legend.warn', 'de', 'Gelb: Bestellposition gefunden, aber außerhalb der Toleranz'),
 ('pomatch.legend.bad', 'de', 'Rot: keine Bestellposition für diese Rechnungsposition'),
 ('pomatch.legend.dot', 'de', 'Punkt: von einer Person zugeordnet, nicht über die Referenz des Lieferanten'),
 ('pomatch.chip.matched', 'de', 'P{n} ✓'),
 ('pomatch.chip.over', 'de', 'P{n} · {pct}'),
 ('pomatch.chip.unit', 'de', 'P{n} · Einheit'),
 ('pomatch.chip.check', 'de', 'P{n} · prüfen'),
 ('pomatch.chip.nopoline', 'de', 'Keine Bestellposition'),
 ('pomatch.suggestedby', 'de', 'Vorschlag übernommen von {who}'),
 ('pomatch.pop.title', 'de', 'Position {n} gegen die Bestellung'),
 ('pomatch.pop.sub', 'de', 'Bestellung {po}'),
 ('pomatch.pop.invoice', 'de', 'Rechnungsposition'),
 ('pomatch.pop.po', 'de', 'Bestellposition'),
 ('pomatch.pop.open', 'de', 'PO-Abgleich öffnen'),
 ('pomatch.pop.readonly', 'de', 'Hier nur lesbar. Um den Abgleich zu ändern, die Rechnung an die Abgleich-Stufe zurückgeben.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'pomatch.col.match' OR key LIKE 'pomatch.legend.%' OR key LIKE 'pomatch.chip.%' OR key = 'pomatch.suggestedby' OR key LIKE 'pomatch.pop.%' == 34
