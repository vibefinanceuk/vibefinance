-- 0155_coding_suggestion_string.sql
-- Account Coding suggestions — decision 0457, Phase 1 of the
-- autocode idea the operator raised: a frequency-based default for
-- the Coding pop-out's own four fields, computed from a supplier's
-- own prior keyed history.
--
-- One new key: the note shown beside a field the pop-out pre-filled
-- with a suggestion nobody has confirmed yet (viewer.js's own
-- `stillSuggested` — cleared the moment a person actually chooses
-- anything for that field, whether the same value or a different
-- one). Every other string this decision needs — the pop-out's own
-- heading, search hint, and so on — already exists from migration
-- 0154 and is reused unchanged.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.coding.suggested', 'en', 'Suggested from this supplier''s own history — review before saving.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.coding.suggested', 'de', 'Vorschlag aus der bisherigen Kontierung dieses Lieferanten — vor dem Speichern prüfen.');

-- Point-in-time: the key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'viewer.coding.suggested' == 2
