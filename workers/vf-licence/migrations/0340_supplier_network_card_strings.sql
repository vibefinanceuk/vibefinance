-- 0340_supplier_network_card_strings.sql
-- Decision 0739 — the supplier record's card: called Supplier Network, and the invitation's words.

UPDATE ui_strings SET value = 'Supplier Network' WHERE key = 'suppliers.portal.title' AND locale = 'en';
UPDATE ui_strings SET value = 'Lieferantennetzwerk' WHERE key = 'suppliers.portal.title' AND locale = 'de';
UPDATE ui_strings SET value = 'Invitee will see documents shared for the organisations specified.' WHERE key = 'suppliers.portal.help' AND locale = 'en';
UPDATE ui_strings SET value = 'Eingeladene sehen die Belege, die für die angegebenen Organisationen geteilt werden.' WHERE key = 'suppliers.portal.help' AND locale = 'de';
UPDATE ui_strings SET value = '{n} supplier(s) have their own setting, on their page''s Supplier Network card.' WHERE key = 'apsetup.network.own' AND locale = 'en';
UPDATE ui_strings SET value = '{n} Lieferant(en) haben eine eigene Einstellung, auf der Karte Lieferantennetzwerk ihrer Seite.' WHERE key = 'apsetup.network.own' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'suppliers.portal.title' AND value IN ('Supplier Network', 'Lieferantennetzwerk') == 2
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'suppliers.portal.help' AND value LIKE 'Invitee will see documents%' == 1
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'suppliers.portal.help' AND value LIKE 'Eingeladene sehen%' == 1
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'apsetup.network.own' AND value LIKE '%portal%' == 0
