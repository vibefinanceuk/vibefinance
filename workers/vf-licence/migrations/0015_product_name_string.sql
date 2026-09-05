-- 0015_product_name_string.sql
-- Decision 0107 — the product's own name, as a string.
--
-- The sign-in heading was a literal in the markup. Left there it would
-- flash "VibeFinance" before a customer's livery replaced it, and could
-- never be translated at all.
--
-- It is genuinely a word on a screen, so it belongs with the others.
-- A customer's own name still comes from their branding
-- (`--brand-name`, decision 0096) and overrides this once known — this
-- is what shows before an instance has been chosen.
INSERT INTO ui_strings (key, locale, value) VALUES ('product.name', 'en', 'VibeFinance');
INSERT INTO ui_strings (key, locale, value) VALUES ('product.name', 'de', 'VibeFinance');

-- Point-in-time: the key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'product.name' == 2
