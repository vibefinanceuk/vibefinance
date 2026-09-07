-- 0041_read_only_stage.sql
-- Decision 0143 — a stage that is read-only, rather than a stage where
-- every field happens to be listed.
--
-- Decision 0114 gave a stage the power to restrict a field, and a stage
-- may only tighten — enforced by the CHECK on
-- `stage_field_visibility.visibility`, which refuses `'edit'`.
--
-- **That is per field, and an approval stage is not per field.** The
-- intent is a property of the stage: *"approvers should approve data,
-- not edit data"* (decision 0114's own words). Expressing it as a list
-- means:
--
-- * Somebody has to list every field, and the operator listed three
--   header fields and no line fields — so lines stayed editable and a
--   Save button appeared on an approval screen.
-- * **A field added to the vocabulary next month is editable there**,
--   and nobody finds out. The list cannot know about a field that did
--   not exist when it was written.
--
-- The same shape decision 0107 records: a hand-maintained list decays,
-- and the fix is to derive rather than to enumerate.
ALTER TABLE process_stages ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0
  CHECK (read_only IN (0, 1));

-- Point-in-time: no stage is read-only yet, so nothing changes for
-- anybody until somebody says so.
-- ASSERT: SELECT count(*) FROM process_stages WHERE read_only = 1 == 0

-- Standing invariant: a read-only stage never carries a field
-- visibility of 'edit'.
--
-- The CHECK above already refuses 'edit' in this table, so this cannot
-- fire today — kept because it states the relationship a reader needs
-- and would catch a future column that relaxed it.
-- ASSERT ALWAYS: SELECT count(*) FROM stage_field_visibility WHERE visibility = 'edit' == 0
