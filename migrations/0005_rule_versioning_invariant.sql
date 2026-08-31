-- 0005_rule_versioning_invariant.sql
-- Rule versioning (see docs/decisions/0014-rule-versioning.md).
-- No new columns needed — rule_versions already has everything a
-- second, third, ... version of an existing rule requires (version,
-- effective_from, effective_to, approved_by, approved_at). This
-- migration adds exactly one thing: a database-level guarantee that
-- was previously enforced by application logic alone.
--
-- The design: activating a new version of a rule closes the
-- previously-open version's effective_to at the moment the new one's
-- effective_from begins (activate-route.ts) — a clean handoff, no gap,
-- no overlap, full history preserved (an old version's row is never
-- deleted or altered beyond closing its window). At any moment, at
-- most one version of a given rule should have approved_by set and
-- effective_to still NULL — the one currently actually in force.
--
-- Enforced twice, the same defense-in-depth discipline already applied
-- everywhere else in this project: application logic in
-- activate-route.ts does the closing, and this partial unique index
-- makes it structurally impossible for two "currently open" versions
-- of the same rule to exist even if that application logic has a bug —
-- a silent correctness error becomes a loud INSERT/UPDATE failure
-- instead.
CREATE UNIQUE INDEX idx_one_open_version_per_rule
  ON rule_versions(rule_id)
  WHERE approved_by IS NOT NULL AND effective_to IS NULL;

-- Standing invariant: the same property the index above enforces,
-- restated as an explicit ASSERT so the migration replay tool reports
-- it directly rather than only ever surfacing as an opaque constraint
-- violation.
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT rule_id FROM rule_versions WHERE approved_by IS NOT NULL AND effective_to IS NULL GROUP BY rule_id HAVING count(*) > 1) == 0
