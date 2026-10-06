-- 0290_three_way_strings.sql
-- Decision 0647 — three-way matching: the two standard rules' names, and the
-- receipt verdicts in the PO matching panel.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('matching.standardrule.awaiting_receipt.name', 'en', 'Standard rule: Awaiting receipt'),
 ('matching.standardrule.awaiting_receipt.name', 'de', 'Standardregel: Wareneingang ausstehend'),
 ('matching.standardrule.credit_expected.name', 'en', 'Standard rule: Credit expected'),
 ('matching.standardrule.credit_expected.name', 'de', 'Standardregel: Gutschrift erwartet'),
 ('pomatch.matching', 'en', 'Matching'),
 ('pomatch.matching', 'de', 'Abgleich'),
 ('pomatch.receipt.ok', 'en', 'Received: {received} kept, {invoiced} invoiced'),
 ('pomatch.receipt.ok', 'de', 'Eingegangen: {received} behalten, {invoiced} berechnet'),
 ('pomatch.receipt.awaiting', 'en', 'Awaiting receipt: {received} kept, {invoiced} invoiced'),
 ('pomatch.receipt.awaiting', 'de', 'Wareneingang ausstehend: {received} behalten, {invoiced} berechnet'),
 ('pomatch.receipt.credit', 'en', 'Credit expected: {returned} returned, {invoiced} invoiced'),
 ('pomatch.receipt.credit', 'de', 'Gutschrift erwartet: {returned} zurück, {invoiced} berechnet'),
 ('pomatch.awaitingwarn', 'en', 'Lines invoiced beyond what has been received and kept: {n}. The receipt rules decide whether the invoice waits.'),
 ('pomatch.awaitingwarn', 'de', 'Positionen über das Eingegangene und Behaltene hinaus berechnet: {n}. Die Wareneingangsregeln entscheiden, ob die Rechnung wartet.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('matching.standardrule.awaiting_receipt.name', 'matching.standardrule.credit_expected.name', 'pomatch.matching', 'pomatch.receipt.ok', 'pomatch.receipt.awaiting', 'pomatch.receipt.credit', 'pomatch.awaitingwarn') == 14
