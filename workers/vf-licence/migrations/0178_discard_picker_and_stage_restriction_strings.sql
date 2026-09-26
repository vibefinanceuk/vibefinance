-- 0178_discard_picker_and_stage_restriction_strings.sql
-- Decision 0502 — Discard gets its own picker (like Return and Return
-- To Supplier before it) and a per-stage restriction on offering it at
-- all (migrations/0091_stage_actions_discard_allowed.sql, vf-app).
--
-- Two new strings: the picker's own reason-field label, the same
-- "Reason" convention `action.return.reasonlabel` (migration 0170)
-- already set; and the Stage Restrictions tab's new toggle label,
-- offered alongside "Recheck the rule..." (migration 0167) on every
-- stage panel.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.discard.reasonlabel', 'en', 'Reason'),
 ('apsetup.stagerestrictions.discardallowed', 'en', 'Allow Discard at this stage');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.discard.reasonlabel', 'de', 'Grund'),
 ('apsetup.stagerestrictions.discardallowed', 'de', 'Verwerfen an dieser Stufe zulassen');

-- Point-in-time: both new keys exist in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('action.discard.reasonlabel', 'apsetup.stagerestrictions.discardallowed') == 4
