-- 0013_per_line_evaluation.sql
-- Per-line rule evaluation — see docs/decisions/0027-per-line-rule-
-- evaluation.md and decisions 0015/0022's own flagged gap. invoice_
-- lines (decision 0017) has been write-only until now: every route
-- that touches it only ever DELETEs and re-INSERTs; nothing has ever
-- read a line back for evaluation. This is what closes that gap.

-- A stage's rule set evaluates once against header facts ('header',
-- the existing, unchanged behavior — the default, so every stage that
-- already exists keeps working exactly as it does today), or once per
-- line, merging header facts with each line's own facts in turn
-- ('line') — decision 0015's own confirmed example: a two-line
-- invoice, each line checked against its own cost centre's threshold
-- independently.
ALTER TABLE process_stages ADD COLUMN evaluation_scope TEXT NOT NULL DEFAULT 'header';

-- Which line (by line number, not a foreign key — see the decision
-- doc for why) a given evaluation step or spawned task belongs to.
-- NULL for header-scope evaluations, unchanged from today.
ALTER TABLE stage_visit_steps ADD COLUMN line_number INTEGER;
ALTER TABLE tasks ADD COLUMN line_number INTEGER;

-- Standing invariant: evaluation_scope is closed to the two values
-- the engine actually knows how to handle — the same discipline
-- CIUS_PROFILES and rule_sets.vocabulary already apply to their own
-- closed columns.
-- ASSERT ALWAYS: SELECT count(*) FROM process_stages WHERE evaluation_scope NOT IN ('header', 'line') == 0
