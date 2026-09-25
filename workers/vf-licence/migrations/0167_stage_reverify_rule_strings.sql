-- 0167_stage_reverify_rule_strings.sql
-- Decision 0487 — the Stage Restrictions tab's new toggle for whether
-- Complete, at a stage, refuses until the rule that raised the task no
-- longer matches (migrations/0082_stage_actions.sql, vf-app).
--
-- One new string: the toggle's own label, offered on every stage
-- panel alongside "Offer Account Coding restrictions for this stage"
-- (migration 0166) — a second, independent property of the same
-- panel, not nested under it.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.stagerestrictions.reverifyoncomplete', 'en', 'Recheck the rule that raised this task before Complete succeeds');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.stagerestrictions.reverifyoncomplete', 'de', 'Vor Abschluss die Regel erneut prüfen, die diese Aufgabe ausgelöst hat');

-- Point-in-time: the new key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'apsetup.stagerestrictions.reverifyoncomplete' == 2
