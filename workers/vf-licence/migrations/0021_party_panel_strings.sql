-- 0021_party_panel_strings.sql
-- Decision 0115 — the seller and buyer panels need headings.
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.seller', 'en', 'Seller');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.buyer', 'en', 'Buyer');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.seller', 'de', 'Verkäufer');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.buyer', 'de', 'Käufer');

-- Point-in-time: both headings exist in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('viewer.seller','viewer.buyer') == 4
