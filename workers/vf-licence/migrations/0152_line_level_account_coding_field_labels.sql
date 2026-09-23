-- 0152_line_level_account_coding_field_labels.sql
-- Decision 0451 — Line Level Account Coding.
--
-- Three new line-scope vocabulary fields (`coding.project`,
-- `coding.commodity_code`, `coding.gl_code` — shared/interpreter/
-- vocabulary.ts) need a `field.<code>` label each, the same
-- `field.bt-133` already carries (migration 0020) — `viewer.js`'s
-- `t(\`field.${spec.field.toLowerCase()}\`)` reads this key for every
-- line column's header and label text, and `string-coverage.test.ts`'s
-- `FIELD_LABEL_KEYS` (derived from INVOICE_FIELDS, not hand-listed)
-- fails the build the moment a declared field has no word behind it.
--
-- Kept in sentence case, matching field.bt-133's own "Cost centre"
-- rather than the AP Setup tab labels' Title Case (migration 0147's
-- "Commodity Code") — those are a different screen's own convention,
-- not this one's.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('field.coding.project', 'en', 'Project'),
 ('field.coding.commodity_code', 'en', 'Commodity code'),
 ('field.coding.gl_code', 'en', 'General ledger code');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('field.coding.project', 'de', 'Projekt'),
 ('field.coding.commodity_code', 'de', 'Warengruppe'),
 ('field.coding.gl_code', 'de', 'Sachkonto');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('field.coding.project','field.coding.commodity_code','field.coding.gl_code') == 6
