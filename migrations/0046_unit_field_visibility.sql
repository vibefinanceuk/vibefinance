-- 0046_unit_field_visibility.sql
--
-- **Which fields a unit may key** — decision 0197.
--
-- The second thing decision 0192 scopes, and deliberately the same
-- shape as the first (decision 0196): the stage's own rows are the
-- group's answer, and a unit may override **a field at a time**.
--
-- **A field at a time is the whole point.** If a French override
-- replaced the stage's whole set, then restricting one field in France
-- would silently drop every restriction the group had made — a
-- loosening dressed as a tightening, which is exactly what decision
-- 0143 watched for when it made a stage read-only as a property rather
-- than as a list of fields somebody keeps complete.
--
-- So resolution is per field: France's rule for `BT-112` wins for
-- `BT-112`, and the group's rule for `BT-110` still applies to
-- `BT-110`.

CREATE TABLE stage_field_visibility_overrides (
  stage_id   TEXT NOT NULL REFERENCES process_stages(id),

  -- An operating unit or a legal entity. An override on Acme France
  -- applies to every operating unit beneath it — the same reasoning as
  -- decision 0196.
  unit_id    TEXT NOT NULL REFERENCES org_units(id),

  field      TEXT NOT NULL,

  -- **Three values, where the base table has two.** `read` and `hidden`
  -- restrict, as they always have; `edit` exists **only here**, so a
  -- unit can restore a field the group restricted.
  --
  -- Without it an override could only tighten, and a customer whose
  -- group hides a field would have no way to say *"except in France."*
  visibility TEXT NOT NULL CHECK (visibility IN ('edit', 'read', 'hidden')),

  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- One answer per stage, unit and field. Two would make resolution
  -- depend on row order.
  PRIMARY KEY (stage_id, unit_id, field)
);

CREATE INDEX idx_field_visibility_overrides_unit
  ON stage_field_visibility_overrides(unit_id);

-- Point-in-time: nothing is overridden, so every stage behaves exactly
-- as it did before this migration.
-- ASSERT: SELECT count(*) FROM stage_field_visibility_overrides == 0

-- Standing invariant: an override never restates what the stage already
-- says. That is a row which does nothing and reads as though it does
-- something — the same argument decision 0196 made for rule sets.
-- ASSERT ALWAYS: SELECT count(*) FROM stage_field_visibility_overrides o JOIN stage_field_visibility s ON s.stage_id = o.stage_id AND s.field = o.field WHERE s.visibility = o.visibility == 0
