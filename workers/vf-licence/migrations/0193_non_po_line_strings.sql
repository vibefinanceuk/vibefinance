-- 0193_non_po_line_strings.sql
-- Decision 0537. A PO invoice's line marked Non-PO at Matching: the
-- picker option, the chip and legend, the Coding column's read-only
-- notes, and the Timeline.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('pomatch.pair.nonpo', 'en', 'Non-PO line (code manually)'),
 ('pomatch.nonpoby', 'en', 'Marked Non-PO by {who}'),
 ('pomatch.r.nonpo', 'en', 'Non-PO line'),
 ('pomatch.chip.nonpo', 'en', 'Non-PO'),
 ('pomatch.legend.nonpo', 'en', 'Grey: Non-PO line, not on the order and coded by hand'),
 ('pomatch.codingcleared', 'en', 'Line {n} now has a PO line, so the coding keyed on it was removed.'),
 ('pomatch.pop.nonpo', 'en', 'Not on the order. Coded by hand in the Coding column, like a Non-PO invoice line.'),
 ('viewer.coding.frompo', 'en', 'Matched to PO line {n}. Its coding comes from the purchase order.'),
 ('viewer.coding.needsnonpo', 'en', 'This line has no PO line. To code it, mark it as a Non-PO line at Matching.'),
 ('activity.ponpo', 'en', '{who} marked invoice line {line} as a Non-PO line'),
 ('activity.pocodingcleared', 'en', '(manual coding removed)');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('pomatch.pair.nonpo', 'de', 'Position ohne Bestellung (manuell kontieren)'),
 ('pomatch.nonpoby', 'de', 'Als ohne Bestellung markiert von {who}'),
 ('pomatch.r.nonpo', 'de', 'Ohne Bestellung'),
 ('pomatch.chip.nonpo', 'de', 'Ohne Best.'),
 ('pomatch.legend.nonpo', 'de', 'Grau: Position ohne Bestellung, manuell kontiert'),
 ('pomatch.codingcleared', 'de', 'Position {n} hat jetzt eine Bestellposition, die erfasste Kontierung wurde entfernt.'),
 ('pomatch.pop.nonpo', 'de', 'Nicht in der Bestellung. Wird in der Spalte Kontierung manuell kontiert, wie eine Rechnungsposition ohne Bestellung.'),
 ('viewer.coding.frompo', 'de', 'Der Bestellposition {n} zugeordnet. Die Kontierung kommt aus der Bestellung.'),
 ('viewer.coding.needsnonpo', 'de', 'Diese Position hat keine Bestellposition. Zum Kontieren beim Abgleich als Position ohne Bestellung markieren.'),
 ('activity.ponpo', 'de', '{who} hat Rechnungsposition {line} als Position ohne Bestellung markiert'),
 ('activity.pocodingcleared', 'de', '(manuelle Kontierung entfernt)');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('pomatch.pair.nonpo', 'pomatch.nonpoby', 'pomatch.r.nonpo', 'pomatch.chip.nonpo', 'pomatch.legend.nonpo', 'pomatch.codingcleared', 'pomatch.pop.nonpo', 'viewer.coding.frompo', 'viewer.coding.needsnonpo', 'activity.ponpo', 'activity.pocodingcleared') == 22
