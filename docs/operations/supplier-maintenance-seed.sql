-- Seeding the Supplier Maintenance process — decision 0350.
--
-- NOT A MIGRATION, deliberately, for the same reason
-- ap-live-process-definition.sql is not one: this is one customer's
-- own configuration (a named process, a named team, a particular
-- rule), not something every customer's database should get asserted
-- onto it.
--
-- Run once, by the operator, against vf-app-poc:
--
--   npx wrangler d1 execute vf-app-poc --remote --file=docs/operations/supplier-maintenance-seed.sql
--
-- WHAT THIS ASSUMES, AND WHY: `Supplier Maintenance` needs a real
-- `unit_id` (org_teams.unit_id is NOT NULL — decision 0332). This
-- session has no visibility into which real org units exist in the
-- live database, so the team is deliberately assigned to whichever
-- org unit has no parent — the top-level entity, which every real
-- customer setup has exactly one of. REVIEW THIS BEFORE RUNNING: if
-- more than one top-level unit exists, or a different one is the
-- right home for this team, change the subquery below to a specific,
-- known unit_id first.
--
-- THE RULE ITSELF IS HAND-WRITTEN, NOT COMPILED BY the real compiler.
-- The compiler runs on Cloudflare Workers AI, which this session has
-- no credentials for. What follows is exactly the JSON shape the
-- compiler itself would have produced for the sentence below —
-- validated directly against the real interpreter (validateRule,
-- evaluateRuleSet) before being written here, not merely believed
-- correct. Reviewed before running, the same as any compiled rule
-- would be before activation.

-- ---------------------------------------------------------------
-- 1. The process itself. version defaults to 1 (migration 0043).
-- ---------------------------------------------------------------
INSERT INTO processes (id, name) VALUES ('supplier-maintenance', 'Supplier Maintenance');

-- ---------------------------------------------------------------
-- 2. Its one stage. required_permission is set directly on the
-- stage (decision 0200) rather than left to the rule alone — the
-- mistake of a rule assigning a task requiring a different
-- permission than the stage declares becomes unsayable, not merely
-- unlikely.
-- ---------------------------------------------------------------
INSERT INTO process_stages (id, process_id, name, sequence, evaluation_scope, required_permission)
VALUES ('supplier-maintenance-review', 'supplier-maintenance', 'Review', 1, 'header', 'Supplier.Maintain');

-- Membership in version 1 — decision 0150/0349. A stage in no
-- version is a stage nothing can reach; handleCreateStage does this
-- automatically through the real route, and this script does the
-- same thing directly since it is writing rows by hand.
INSERT INTO process_stage_versions (process_id, version, stage_id, sequence)
VALUES ('supplier-maintenance', 1, 'supplier-maintenance-review', 1);

-- ---------------------------------------------------------------
-- 3. The team. Assigned to the top-level org unit — see the note
-- above. REVIEW before running.
-- ---------------------------------------------------------------
INSERT INTO org_teams (id, name, unit_id)
VALUES (
  'supplier-maintenance-team',
  'Supplier Maintenance',
  (SELECT id FROM org_units WHERE parent_unit_id IS NULL ORDER BY name LIMIT 1)
);

UPDATE process_stages SET rule_set_id = 'supplier-maintenance-rules'
WHERE id = 'supplier-maintenance-review';

-- ---------------------------------------------------------------
-- 4. The rule set and its one rule — vocabulary 'supplier'
-- (decision 0350), not 'invoice'. first_match, since there is only
-- ever one rule to consider.
-- ---------------------------------------------------------------
INSERT INTO rule_sets (id, name, mode, status, vocabulary)
VALUES ('supplier-maintenance-rules', 'Supplier Maintenance Rules', 'first_match', 'active', 'supplier');

INSERT INTO rules (id, rule_set_id, sort_order, enabled)
VALUES ('b59c31d1-82c6-488d-ab98-3320569b32c6', 'supplier-maintenance-rules', 1, 1);

-- The sentence: "Assign a task to the Supplier Maintenance team
-- requiring Supplier.Maintain." — every instance of this process
-- exists specifically to raise this one task, so the condition
-- tests only that the instance has a real subject at all (`id` is
-- always supplied — see supplier-maintenance.ts's own
-- spawnSupplierMaintenanceInstance), rather than distinguishing
-- reason: both a new supplier and a changed one need the same
-- validation.
INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by, approved_by, approved_at, effective_from)
VALUES (
  'b59c31d1-82c6-488d-ab98-3320569b32c6',
  1,
  'Assign a task to the Supplier Maintenance team requiring Supplier.Maintain.',
  '{"conditions":{"all":[{"field":"id","operator":"is_present"}]},"actions":[{"type":"assign_task","params":{"team":"supplier-maintenance-team","permission":"Supplier.Maintain"}}]}',
  'hand-written, decision 0350 — see the note at the top of this file',
  'operator',
  datetime('now'),
  datetime('now')
);
