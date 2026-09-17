-- 0119_org_unit_vatid_renamed_tax_identifier.sql
-- Decision 0379 — the operator's own request: "update the recorded
-- title Vat ID to read Tax Identifier." An UPDATE to the existing key
-- (migration 0102), not an edit to that migration in place — it is
-- already applied, and an applied migration is not edited without
-- saying so.
--
-- The key itself (roles.vatid) is unchanged, since it is an internal
-- identifier rather than user-facing text, and every call site
-- (the org unit form and, now, the Org Units table's own column) reads
-- through it, so one update covers both.
UPDATE ui_strings SET value = 'Tax Identifier' WHERE key = 'roles.vatid' AND locale = 'en';
UPDATE ui_strings SET value = 'Steuerliche Identifikationsnummer' WHERE key = 'roles.vatid' AND locale = 'de';

-- Point-in-time: both locales carry the new wording.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'roles.vatid' AND value IN ('Tax Identifier', 'Steuerliche Identifikationsnummer') == 2
