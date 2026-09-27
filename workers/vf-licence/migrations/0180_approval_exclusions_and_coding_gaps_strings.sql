-- 0180_approval_exclusions_and_coding_gaps_strings.sql
-- Decision 0513. Four new strings:
--   * the two AP Setup options the operator named for Approval
--     Hierarchy (labels beside their checkboxes);
--   * the heading of a Complete refused because Account Coding is not
--     complete, and the phrase for a field left empty. A value that is
--     present but not on the lists reuses decision 0511's own
--     `viewer.coding.invalid.*` phrases (migration 0179).
--
-- No value contains `;`, because test/setup.ts's statement splitter
-- can't see inside quoted literals (decision 0445).

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.excludevalidationuser', 'en', 'Exclude Validation User from Approval of Invoices'),
 ('apsetup.excludecodinguser', 'en', 'Exclude Coding User from Approval of Invoices'),
 ('viewer.coding.incomplete', 'en', 'Account Coding is not complete. Code every line before completing:'),
 ('viewer.coding.missing', 'en', 'is missing');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.excludevalidationuser', 'de', 'Prüfer der Validierung von der Rechnungsfreigabe ausschließen'),
 ('apsetup.excludecodinguser', 'de', 'Bearbeiter der Kontierung von der Rechnungsfreigabe ausschließen'),
 ('viewer.coding.incomplete', 'de', 'Die Kontierung ist nicht vollständig. Kontieren Sie jede Position vor dem Abschließen:'),
 ('viewer.coding.missing', 'de', 'fehlt');

-- Point-in-time: all four new keys exist in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('apsetup.excludevalidationuser', 'apsetup.excludecodinguser', 'viewer.coding.incomplete', 'viewer.coding.missing') == 8
