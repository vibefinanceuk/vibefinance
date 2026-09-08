-- 0039_rules_screen_wording.sql
-- Decision 0154 — "Create rule", from the operator.
--
-- **"Write a new rule" describes the act; "Create rule" names the
-- thing.** An interface's vocabulary is signposting, and the shorter
-- form matches the buttons beside it — the same reasoning that made
-- "Open in new window" into "Expand" (decision 0122).
UPDATE ui_strings SET value = 'Create rule' WHERE key = 'rules.new' AND locale = 'en';
UPDATE ui_strings SET value = 'Regel erstellen' WHERE key = 'rules.new' AND locale = 'de';

-- Point-in-time: the wording changed and nothing was lost.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'rules.new' == 2
