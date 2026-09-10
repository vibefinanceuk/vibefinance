-- 0045_unit_rule_sets.sql
--
-- **Which rules run here, for whom** — decision 0196.
--
-- Decision 0192 chose to scope configuration to an operating unit
-- rather than split a customer across databases, and named the shape: a
-- nullable scope where absent means *the group's own*, resolved by
-- walking up decision 0036's tree.
--
-- This is the first thing scoped, and the choice of which is
-- deliberate. **A process is the wrong grain.** France and Germany
-- almost always want the *same* stages and *different* thresholds — so
-- scoping the whole process would mean duplicating seven stages to
-- change one rule, and every later change made twice.
--
-- So a stage keeps its own `rule_set_id` as the group's answer, and a
-- unit may **override it for that stage alone**. Nothing migrates:
-- every stage today has exactly the behaviour it had yesterday, and an
-- override is a row somebody adds.

CREATE TABLE stage_rule_set_overrides (
  stage_id    TEXT NOT NULL REFERENCES process_stages(id),

  -- The unit this override is for. **An operating unit or a legal
  -- entity**: an override on Acme France applies to every operating
  -- unit beneath it, which is how a country-wide rule is expressed
  -- once rather than per department.
  unit_id     TEXT NOT NULL REFERENCES org_units(id),

  rule_set_id TEXT NOT NULL REFERENCES rule_sets(id),

  created_at  TEXT NOT NULL DEFAULT (datetime('now')),

  -- One answer per stage per unit. Two would make resolution depend on
  -- row order, which is not a rule anybody could state.
  PRIMARY KEY (stage_id, unit_id)
);

CREATE INDEX idx_stage_overrides_unit ON stage_rule_set_overrides(unit_id);

-- Point-in-time: nothing is overridden, so every stage behaves exactly
-- as it did before this migration.
-- ASSERT: SELECT count(*) FROM stage_rule_set_overrides == 0

-- Standing invariant: an override names a rule set that exists and a
-- stage that exists. The foreign keys say so; this states it where a
-- reader of the migrations will see it.
-- ASSERT ALWAYS: SELECT count(*) FROM stage_rule_set_overrides o LEFT JOIN rule_sets r ON r.id = o.rule_set_id WHERE r.id IS NULL == 0

-- Standing invariant: an override never points at the same rule set the
-- stage already uses. That is not an override, it is a row that does
-- nothing and reads as though it does something.
-- ASSERT ALWAYS: SELECT count(*) FROM stage_rule_set_overrides o JOIN process_stages s ON s.id = o.stage_id WHERE s.rule_set_id = o.rule_set_id == 0
