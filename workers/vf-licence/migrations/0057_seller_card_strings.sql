-- 0057_seller_card_strings.sql
-- Decision 0220 — one Seller card, not two.
--
-- Decision 0219's separate *Supplier on file* card is gone, so its
-- heading is no longer shown anywhere. **Left in place rather than
-- deleted**: a string a customer may have translated is not something
-- to remove in passing, and an unused row costs nothing where a missing
-- one shows a key on screen.
UPDATE ui_strings SET value = 'Seller' WHERE key = 'viewer.supplier' AND locale = 'en';
UPDATE ui_strings SET value = 'Verkäufer' WHERE key = 'viewer.supplier' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'viewer.supplier' AND value IN ('Seller', 'Verkäufer') == 2
