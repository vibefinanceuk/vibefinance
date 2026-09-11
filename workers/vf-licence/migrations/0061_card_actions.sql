-- 0061_card_actions.sql
-- Decision 0228 — a card's own action.
--
-- **"Change", not "Edit."** Neither of these changes a record: they
-- replace one with another, and the invoice stops pointing at Acme UK
-- and starts pointing at Acme Deutschland while both records stay
-- exactly as they were.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.changebuyer', 'en', 'Change Buyer'),
 ('action.changeseller', 'en', 'Change Seller'),
 ('action.changebuyer', 'de', 'Käufer ändern'),
 ('action.changeseller', 'de', 'Verkäufer ändern');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('action.changebuyer','action.changeseller') == 4
