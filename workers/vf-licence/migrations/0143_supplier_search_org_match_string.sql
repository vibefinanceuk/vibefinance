-- 0143_supplier_search_org_match_string.sql
-- Decision 0433 — why a supplier search result is ranked near the top.
--
-- The manual "select the right supplier" search now ranks a site tagged
-- to the invoice's own buying entity first, the same signal
-- `matchSupplier`'s own automatic tiebreak already uses (decision
-- 0317). This is the one new label that ranking needs: read beside the
-- existing "Payment" site marker, in the same `describe()` line
-- decision 0222 already builds.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('suppliers.sameorg', 'en', 'Same org as this invoice'),
 ('suppliers.sameorg', 'de', 'Gleiche Org wie diese Rechnung');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'suppliers.sameorg' == 2
