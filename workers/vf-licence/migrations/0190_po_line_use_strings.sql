-- 0190_po_line_use_strings.sql
-- Decision 0533. The PO matching panel, phase 3: how much of each PO
-- line is used, and verdict wording that says "over", since matching
-- now flags only over-billing and over-delivery against what is left.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('pomatch.lineuse', 'en', 'Ordered {ordered} · invoiced before {before} · this invoice {mine} · left {left}'),
 ('pomatch.unusedleft', 'en', '{n} left');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('pomatch.lineuse', 'de', 'Bestellt {ordered} · bereits berechnet {before} · diese Rechnung {mine} · verbleibend {left}'),
 ('pomatch.unusedleft', 'de', '{n} verbleibend');

UPDATE ui_strings SET value = 'Over the PO by {pct}' WHERE key = 'pomatch.r.price' AND locale = 'en';
UPDATE ui_strings SET value = 'Über der Bestellung um {pct}' WHERE key = 'pomatch.r.price' AND locale = 'de';
UPDATE ui_strings SET value = 'Quantity over what is left by {pct}' WHERE key = 'pomatch.r.qty' AND locale = 'en';
UPDATE ui_strings SET value = 'Menge über dem Rest um {pct}' WHERE key = 'pomatch.r.qty' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('pomatch.lineuse', 'pomatch.unusedleft') == 4
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'pomatch.r.price' AND locale = 'en' AND value = 'Over the PO by {pct}' == 1
