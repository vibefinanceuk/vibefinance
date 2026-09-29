-- 0200_po_status_strings.sql
-- Decision 0545. An invoice against a purchase order that is on hold or
-- closed is not matched: the new po_status check's label, the warning
-- in the PO matching panel and the line Match pop-out, and the fifth
-- standard matching rule's name (shown as a task's open reason).

INSERT INTO ui_strings (key, locale, value) VALUES
 ('check.po_status', 'en', 'The purchase order is on hold or closed'),
 ('check.po_status', 'de', 'Die Bestellung ist gesperrt oder geschlossen'),
 ('pomatch.onholdwarn', 'en', 'This purchase order is on hold. The invoice is not matched until the order is released.'),
 ('pomatch.onholdwarn', 'de', 'Diese Bestellung ist gesperrt. Die Rechnung gilt erst nach Freigabe der Bestellung als abgeglichen.'),
 ('pomatch.onholdwarn.reason', 'en', 'This purchase order is on hold: {reason}. The invoice is not matched until the order is released.'),
 ('pomatch.onholdwarn.reason', 'de', 'Diese Bestellung ist gesperrt: {reason}. Die Rechnung gilt erst nach Freigabe der Bestellung als abgeglichen.'),
 ('pomatch.closedwarn', 'en', 'This purchase order is closed. The invoice is not matched against it.'),
 ('pomatch.closedwarn', 'de', 'Diese Bestellung ist geschlossen. Die Rechnung wird nicht mit ihr abgeglichen.'),
 ('matching.standardrule.po_status.name', 'en', 'Standard rule: Purchase order on hold or closed'),
 ('matching.standardrule.po_status.name', 'de', 'Standardregel: Bestellung gesperrt oder geschlossen');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('check.po_status','pomatch.onholdwarn','pomatch.onholdwarn.reason','pomatch.closedwarn','matching.standardrule.po_status.name') == 10
