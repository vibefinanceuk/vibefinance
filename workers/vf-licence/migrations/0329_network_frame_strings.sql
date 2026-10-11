-- 0329_network_frame_strings.sql
-- Decision 0725 — the supplier network in the application's own frame: its
-- side menu (a Supplier network group with Documents) and the Documents
-- screen's customer filter and count.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('network.nav.group', 'en', 'Supplier network'),
 ('network.nav.group', 'de', 'Lieferantennetzwerk'),
 ('network.nav.groupshort', 'en', 'NET'),
 ('network.nav.groupshort', 'de', 'NETZ'),
 ('network.nav.documents', 'en', 'Documents'),
 ('network.nav.documents', 'de', 'Dokumente'),
 ('network.customers.all', 'en', 'All customers'),
 ('network.customers.all', 'de', 'Alle Kunden'),
 ('network.count', 'en', '{n} shown'),
 ('network.count', 'de', '{n} angezeigt');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('network.nav.group', 'network.nav.groupshort', 'network.nav.documents', 'network.customers.all', 'network.count') == 10
